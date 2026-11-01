// Task studio-beta-track3-eaton-centre-20261031-01 (Studio Beta, lane ASSETS): runtime derivatives of the NEW mall-art models of
// The Eaton's Center (LevelId `mall`), generated with Meshy T2.5 (smart-topology text-to-3D preview + 2K PBR refine) under the task's
// finite authorization (<= 100 attempts incl. replacements, <= 1500 credits, <= 200 generation POSTs; staged batches frozen by the
// primary). Modelled on build-office-overhaul.mjs.
//
// Reads (never modifies) the task's records kept OUTSIDE Git in reference/tasks/track3-eaton-centre-20261031/assets/:
//   batch-<n>.frozen.json  the primary-frozen batch specs — each verified against the sha256 of its ledger `freeze` line (immutable);
//                          they are the ONLY spec source for a delivered asset (size, axis, tris, prompts)
//   ledger.jsonl           fsynced intent / ack / status / download / inspect records (only ACCEPTED refines are built: an `inspect`
//                          line {kind: 'refine', verdict: 'accepted', front} written after the CPU ortho review)
//   raw/<id>/<attempt>/{preview,refine}/  immutable native GLBs (sha256-verified against the ledger download line)
// and writes deterministically:
//   game/public/assets/models/mall-<id>.glb                 flat path (tools/release/package-ci.mjs publicPath); level-only by path
//                                                           (game/src/assets/levelAssets.ts mall rule)
//   game/public/assets/derivatives/mall-track3-20261031.json provenance (no URLs / tokens)
//   tools/release/public-inputs.json                         ONLY this task's paths added / updated / dropped (or --allowlist-out)
//   game/src/assets/mallAssets.ts                            GENERATED block (urls / bytes / tris: the bundle literals package-ci needs)
//   game/src/assets/mallDims.generated.ts                    GENERATED block (three-free dims + nominal specs for gen/ code)
//   game/public/assets/CREDITS.md                            the marked mall section (only when something is delivered)
//   reference/.../assets/DELIVERED.json                      delivery note for SHOPS / PACKAGE (atomic)
//
// Derivative = rotate about Y so the reviewed native front faces -Z, UNIFORM scale to the frozen real size (sizeM along sizeAxis:
// h = height y, w = width x after rotation, longest), grounded (min y = 0), centred on x/z, baked into the vertices (identity
// nodes). No geometry simplification (Smart Topology made the target triangle count). The native 2K PBR material is kept channel for
// channel (base colour, metallic-roughness, normal), downsized with sharp Lanczos to JPEG by tier:
//   --policy lean (DEFAULT): L (nominal max extent >= 2.0 m) base 1024 / other maps 256, M (>= 0.8 m) 512 / 256, S 512 / 256;
//                            budgets 420 / 260 / 180 kB
//   --policy balanced:       L (>= 1.8 m) 1024 / 512, M 512 / 512, S 512 / 256; budgets 480 / 320 / 200 kB (the office policy)
// with a deterministic step-down ladder per tier. EDITS[id] (after review) ports the office lane-FURN local operations: a painted /
// opaque glass region split into a real transparent 'glass' node, baked loose clutter separated into its own models (rule 4; no
// regeneration), a furniture-only resize.
//
// Usage:
//   node tools/asset-pipeline/props/build-mall-track3.mjs [--policy lean|balanced] [--only M01,M05] [--allowlist-out <file>]
//        [--no-delivered]   do not rewrite the Track3 delivery note (later local repairs, e.g. lane FIX U06 M35)
//        [--only M81]       an EXTRA asset (EXTRA below: an accepted model outside the Track3 frozen batches, with its own task / ledger —
//                           M81 = the female mannequin of task mall-round3-recovery01-20261101); provenance under `extraOutputs`
//   node tools/asset-pipeline/props/build-mall-track3.mjs --dry-run      plan only: verify freezes / ledger / raws, write NOTHING
//   node tools/asset-pipeline/props/build-mall-track3.mjs --dry-run --fixture <any.glb> --fixture-code M05 [--fixture-front +Z]
//        exercise the derive path on a local GLB under a manifest spec -> /tmp/track3-fixture/mall-<id>.glb + report (never public)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, transformPrimitive, getBounds, textureCompress, prune, dedup, compactPrimitive} from '@gltf-transform/functions';
import {GLASS_MATERIAL, components, cleanSupportTexture, cropPartTextures, extentOf, scaleAxis, scaleGroundCentre, splitClutter, splitGlass} from './lib/clutter-split.mjs';
import {dedupeCoplanar} from './lib/coplanar-dedupe.mjs'; // Task mall-playtest-revision-20261031 (lane FIX, U06)
import {cleanPanelGhosts, rebuildPanel, snapVertices} from './lib/panel-repair.mjs'; // Task mall-round2-20261031 (lane PROPS, M04)
// Task mall-round3-20261031 (lane SHOPS, R4): EXTRA assets are decimated with the installed meshoptimizer (as build-user-weapons-iteration10.mjs)
import {weld, simplify} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-track3-eaton-centre-20261031-01';
const TASK_DIR = 'reference/tasks/track3-eaton-centre-20261031';
const ASSETS_DIR = path.join(root, TASK_DIR, 'assets');
const LEDGER = path.join(ASSETS_DIR, 'ledger.jsonl');
const MANIFEST = path.join(ASSETS_DIR, 'manifest.track3.json');
const PUB = path.join(root, 'game/public');
const PROV_REL = 'assets/derivatives/mall-track3-20261031.json';
const PROV = path.join(PUB, PROV_REL);
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const REGISTRY = path.join(root, 'game/src/assets/mallAssets.ts');
const DIMS_TS = path.join(root, 'game/src/assets/mallDims.generated.ts');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS = path.join(PUB, CREDITS_REL);
const CREDITS_BEGIN = '<!-- BEGIN mall-track3-20261031 (build-mall-track3.mjs) -->';
const CREDITS_END = '<!-- END mall-track3-20261031 -->';
const DELIVERED = path.join(ASSETS_DIR, 'DELIVERED.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const outRelOf = id => `assets/models/mall-${id}.glb`;
const partRelOf = id => `assets/models/mall-${id}.glb`;
const libraryKey = id => `office-${id}`; // SHOPS: mall kinds render through the office prop path (gen/office/kinds.ts officeModelKey)

const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry-run');
const POLICY = argOf('--policy') ?? 'lean';
if (!['lean', 'balanced'].includes(POLICY)) throw new Error('--policy lean|balanced');
const ONLY = argOf('--only') ? new Set(argOf('--only').split(',')) : null;
const ALLOW_OUT = argOf('--allowlist-out');
// (lane FIX, U06) a later local repair must not rewrite the closed Track3 task's delivery note (reference/.../DELIVERED.json)
const NO_DELIVERED = process.argv.includes('--no-delivered');
const FIXTURE = argOf('--fixture'), FIXTURE_CODE = argOf('--fixture-code'), FIXTURE_FRONT = argOf('--fixture-front') ?? '+Z';
if (FIXTURE && !DRY) throw new Error('--fixture is a dry-run tool (never writes public files): add --dry-run');

// ---------- texture policy (tiers by the nominal max extent of the frozen target size) ----------
const POLICIES = {
  lean: {L: 2.0, tiers: {
    L: {budget: 420_000, ladder: [[1024, 256, 85], [1024, 256, 78], [768, 256, 78], [768, 256, 72], [512, 256, 78], [512, 256, 70]]},
    M: {budget: 260_000, ladder: [[512, 256, 85], [512, 256, 78], [512, 256, 72], [384, 256, 72]]},
    S: {budget: 180_000, ladder: [[512, 256, 85], [512, 256, 78], [384, 256, 74], [256, 256, 72]]}}},
  balanced: {L: 1.8, tiers: {
    L: {budget: 480_000, ladder: [[1024, 512, 85], [1024, 512, 80], [1024, 512, 72], [768, 512, 80], [512, 512, 80], [512, 512, 72]]},
    M: {budget: 320_000, ladder: [[512, 512, 85], [512, 512, 80], [512, 512, 72], [512, 256, 72]]},
    S: {budget: 200_000, ladder: [[512, 256, 85], [512, 256, 80], [512, 256, 72], [384, 256, 72]]}}},
};
const tierOf = spec => { const m = Math.max(spec.targetSize.w, spec.targetSize.h, spec.targetSize.d); return m >= POLICIES[POLICY].L ? 'L' : m >= 0.8 ? 'M' : 'S'; };
const PART_TEX_PX = 256, PART_TEX_Q = 85;

// Per-asset observations from the CPU ortho / scale-check reviews, for integrators (filled after inspection; mirrored in DELIVERED.json).
const NOTES = {};
// Local edits after review (office lane-FURN mechanism, no regeneration): {glass: {minY, maxX}} -> transparent 'glass' node;
// {clutter: c => bool, supports: [{y, tol}], parts: {<partId>: {box, sizeM, sizeAxis, label}}} -> baked loose items separated into
// mall-<partId>.glb at their own real size (rule 4); {sizeM, sizeAxis, basis} -> furniture-only resize. Filled per accepted asset.
const EDITS = {
  // M01 (review/b1-raw-M01-M02.png): used as a wall-backed till / back counter (native +Z = drawers + hutch shelves toward the room, the
  // oak screen to the wall). Counter top stood at 0.816 m and the counter was 1.05 m deep at the frozen 2.0 m width -> y x1.164 (top
  // 0.95 m, rule 5 counters 0.9-1.0) and z x0.72 (0.76 m deep); width unchanged. The 84-tri box with a painted gauge face standing on
  // the counter top (staff end, manifest frame x -0.89..-0.55, y 0.81..1.15, z -0.39..-0.07) is a loose item: dropped (rule 4).
  'mall-cashwrap-counter': {basis: 'wall-backed till / back counter; counter top raised 0.816 -> 0.95 m and depth 1.05 -> 0.76 m (per-axis, furniture-only); loose gauge box dropped',
    clutter: c => c.min[1] > 0.79 && c.max[1] < 1.2 && c.centre[0] < -0.45 && c.centre[2] < 0 && c.centre[2] > -0.5 && c.max[0] - c.min[0] < 0.45 && c.max[2] - c.min[2] < 0.45,
    parts: {}, supports: [{y: 0.8162, tol: 0.006}], scaleAxes: [[1, 1.164], [2, 0.72]]}, // supports: the counter top (the box's painted ghost cleaned)
  // M06 (review/M06-…-scale.png): at the frozen 1.0 m the garments spread ~0.70 m across (1.5x a shirt on a hanger beside the zombie):
  // uniform resize to a 0.85 m hanging length (hook to hem; shirts / jackets on hangers ~0.75-0.9 m) -> ~0.6 m across.
  'garment-hanging-group': {basis: 'hanging length 0.85 m (hook to hem), uniform', sizeM: 0.85, sizeAxis: 'h'},
  // M03 (1R slot 81, review/b1g3-*): a squat single-sided section (W:H 1.39; 0.90 m tall at the frozen 1.25 m width): depth z x0.645,
  // then uniform to 1.4 m tall -> 1.95 x 1.40 x 0.49 m (5 shelves ~0.25 m apart). Back-to-back pairs = the double-sided aisle run.
  // Task mall-round2-20261031 (lane PROPS, M07 follow-up — primary: "shelving bay" may also mean this free-standing gondola, label
  // 'gondola shelf'): measured in the final frame (front -Z) — 220 coplanar pairs, 0.90 m2 of overlap. Each shelf is a ~3 cm slab built
  // of interleaved internal sheets 1-5 mm apart; most of the overlap is INSIDE those closed slabs (planes ~0.599 / 0.779 / 0.793 /
  // 0.953 / 1.158, hidden from every view). The visible fights (thin lines, ~1 % of pixels) are stacked layers on the shelves' front-lip
  // plane (z -0.130), the left upright's front (z -0.086) and the centre divider (x ~+0.004..0.013, a stack of thin sheets). dedupe: one
  // layer facing the shopper on the lip and upright planes (clipOpposite: no hole; minAxisCos: no steep slivers) and on the internal
  // planes inside strict slabs that exclude every shelf's visible top and bottom faces (each slab's majority facing kept; positions
  // unchanged: decks / loot unchanged). The divider is NOT deduped: clipping its sheet stack fragments it (59 -> 557 tris, over the
  // byte budget -> lower texture step) for a < 0.1 % pixel effect.
  'retail-gondola': {basis: 'single-sided gondola section 1.4 m tall (uniform), depth trimmed to 0.49 m (z x0.645); coplanar duplicate layers removed (shelf lips, upright, divider, internal shelf sheets; local)',
    scaleAxes: [[2, 0.645]], sizeM: 1.4, sizeAxis: 'h',
    dedupe: [
      {box: {min: [-0.98, 0.25, -0.1311], max: [0.98, 1.25, -0.1291]}, axis: 2, facing: -1, tol: 0.001, clipOpposite: true, minAxisCos: 0.98},
      {box: {min: [-0.98, -0.01, -0.0867], max: [-0.93, 1.41, -0.0847]}, axis: 2, facing: -1, tol: 0.001, clipOpposite: true, minAxisCos: 0.98},
      ...[[0.597, 0.6005, 1], [0.7765, 0.7805, 1], [0.7905, 0.795, -1], [0.9505, 0.956, 1], [1.1565, 1.1625, 1]].map(([y0, y1, facing]) => ({box: {min: [-0.98, y0, -0.14], max: [0.98, y1, 0.245]},
        axis: 1, facing, tol: +(y1 - y0).toFixed(4), slab: [y0, y1], clipOpposite: true, minAxisCos: 0.98}))]},
  // M04 (1R slot 82): 1.2 m wide it stood 2.53 m tall and 0.94 m deep (shelves ~0.56 m) -> y x0.871 (2.2 m, SHOPS wallBay) and
  // z x0.53 (0.50 m deep, shelves ~0.30 m); width kept.
  // Task mall-round2-20261031 (lane PROPS, M07 — user: "shelving bay has a few flickering issues / triangle issues"; label 'shelving bay'):
  // measured in the final frame (front -Z) — the slatwall back panel's shopper-facing plane (z +0.2357, 341 tris) carries, besides its
  // -Z face, an opposite-facing (+Z) layer over its lower diagonal half and a diagonal band of 3-5 overlapping same-facing triangles
  // (327 coplanar pairs, 1.30 m2 of overlap; double-sided material -> the layers' different UV islands / normal-map texels z-fight as the
  // view moves). dedupe: ONE -Z layer over the old coverage (larger triangles keep their texture, the rest clipped exactly around them),
  // +Z duplicates dropped where covered (clipOpposite keeps any uncovered remainder: no hole). Decks, uprights and bounds unchanged.
  'retail-wall-bay': {basis: 'wall bay 1.2 x 2.2 m (SHOPS wallBay), depth 0.50 m (per-axis y x0.871, z x0.53); coplanar duplicate layers of the slatwall back panel removed (local)',
    scaleAxes: [[1, 0.871], [2, 0.53]],
    dedupe: [{box: {min: [-0.61, -0.01, 0.2347], max: [0.61, 2.21, 0.2367]}, axis: 2, facing: -1, tol: 0.001, clipOpposite: true, minAxisCos: 0.98}]},
  // M11 (review/b1g3-*): counter top 0.514 m at the frozen 2.4 m width. The cluster of pill bottles / jars on the counter top's back-right
  // (manifest frame x -0.98..-0.63, y 0.51..0.65, z 0.12..0.29) is loose clutter: dropped (rule 4), its painted ghost cleaned. Then y x1.387,
  // z x0.75 and uniform to 3.2 m wide -> counter top 0.95 m, hutch top ~2.57 m, depth 0.69 m (a pharmacy back-wall counter).
  'pharmacy-dispensary-counter': {basis: 'pharmacy back counter 3.2 m wide, counter top 0.95 m, depth 0.69 m (per-axis + uniform); loose bottle cluster dropped',
    clutter: c => c.min[1] > 0.49 && c.max[1] < 0.7 && c.centre[0] < -0.55 && c.centre[0] > -1.05 && c.centre[2] > 0.05 && c.centre[2] < 0.35 && Math.max(c.max[0] - c.min[0], c.max[2] - c.min[2]) < 0.15,
    parts: {}, supports: [{y: 0.5138, tol: 0.006}], scaleAxes: [[1, 1.387], [2, 0.75]], sizeM: 3.2, sizeAxis: 'w'},
  // M12 (1R2 slot 84, review/b1g4-*): plain long counter, 0.83 m tall and 1.10 m deep at 2.6 m -> y x1.085 (0.90 m), z x0.77 (0.85 m).
  // Its top 'belt channel' is a 0.6 m-deep open trough (floor 0.31 m, review/b1g4-scale-sheet.png) -> a procedural dark-rubber belt deck
  // closes it just under the 0.898 m rim (runtime frame x -1.26..1.24, z +-0.36, y 0.865..0.888), so it reads as a counter with a belt.
  'checkout-lane': {basis: 'lane counter 2.6 x 0.90 x 0.85 m (per-axis y x1.085, z x0.77) + procedural belt deck over the modelled trough',
    scaleAxes: [[1, 1.085], [2, 0.77]], boxes: [{min: [-1.26, 0.865, -0.36], max: [1.24, 0.888, 0.36], color: [0.035, 0.035, 0.04, 1], roughness: 0.8, name: 'belt'}]},
  // M14 (review/b1g4-*): two scoped rifles were modelled on the hook bars of the (open-backed) frame despite 'no guns'. Their bodies,
  // scopes, mounts and small parts are separate components inside the rifle zone (manifest frame x -0.36..0.8, y 0.58..1.27, < 0.1 m
  // deep, < 1.2 m long) -> dropped (rule 4; the uploaded guns stay the only weapons). Kept: the side posts (x +-0.95), the hook bars
  // (1.26 m segments), the hooks (0.18 m deep), the two thin cradle pads on the bars (<= 0.01 m tall) and the lower shelf.
  // (A first, looser predicate also took the 0.103 m-wide side posts and the bars — review/b1g4-runtime.png before this fix.)
  'gun-wall-rack': {basis: 'empty long-gun rack; modelled rifles removed locally',
    clutter: c => { const e = [0, 1, 2].map(k => c.max[k] - c.min[k]); return e[0] < 1.2 && e[2] < 0.1 && e[1] > 0.015 && c.centre[0] > -0.36 && c.centre[0] < 0.8 && c.centre[1] > 0.58 && c.centre[1] < 1.27; },
    parts: {},
    // the bar span under each rifle (x 0.30..0.95) was fused into the rifle and left with it: copies of the two kept 1.26 m bar segments
    // (x -0.96..0.30, y ~0.80 / ~1.14) remapped onto x 0.29..0.95 close the bars to the right-hand post again
    extend: [{pred: c => c.ext[0] > 1.2 && c.ext[0] < 1.4 && c.ext[1] < 0.06 && c.centre[1] > 0.7 && c.centre[1] < 1.25, from: [-0.96, 0.30], to: [0.29, 0.95]}]},
  // M15 (review/b1g4-*): the sloped front glass and the glass shelf are thin separate components painted grey -> a real transparent
  // 'glass' node (shop-cooler contract) so the felt deck (0.44 m) and shelf (~0.89 m) loot shows through; staff side open.
  'glass-display-counter': {basis: 'glass made transparent (component split); depth 0.98 -> 0.71 m (z x0.72)',
    glassComps: c => c.n < 60 && [...c.ext].sort((a, b) => a - b)[1] > 0.45, scaleAxes: [[2, 0.72]]},
  // M16 (review/b1g4-*): 1.16 m tall at 1.5 m wide (3 planks) -> y x1.5 (1.74 m; planks read thicker, pipes taller).
  'outdoors-plank-shelving': {basis: 'pipe + plank shelving 1.5 x 1.74 x 0.48 m (per-axis y x1.5)', scaleAxes: [[1, 1.5]]},
  // M17 (review/b1g5-*): squat at the frozen 2.2 m (1.50 m tall); a per-axis stretch would make the spoked wheels oval -> uniform 2.5 m.
  'mall-kiosk-cart': {basis: 'uniform 2.5 m long (incl. push handles) so the canopy stands ~1.7 m; wheels kept round', sizeM: 2.5, sizeAxis: 'w'},
  // M19: 1.38 m tall at 2.0 m wide -> y x1.45 (2.0 m; thin ledges read slightly thicker).
  'shoe-wall-display': {basis: 'shoe wall 2.0 x 2.0 x 0.23 m (per-axis y x1.45)', scaleAxes: [[1, 1.45]]},
  // M20: table top 0.80 m at the frozen 1.6 m -> uniform to a 0.75 m table top (stool seats ~0.49 m).
  'food-court-table-set': {basis: 'uniform: table top 0.75 m', sizeM: 0.75, sizeAxis: 'h'},
  // M18 (primary, recovery02): the lid flap is modelled RAISED OPEN (22.4 deg, free edge up at the front). Manifest frame (frozen 0.6 m
  // width, front -Z, back +Z): everything starting above the 0.442 m rim (min y > 0.425: lid plate 190 tris, 2 ribs, 2 side arms, 2 back
  // hinge pieces; no shared vertices with the box) is rotated -22.4 deg about X through its hinge line (y 0.431, z 0.249) so it lies flat,
  // then fitted over the rim (x +-0.29, z +-0.292: the flap was only ~0.44 m long) — a closed lid on top of the box.
  'storage-tote': {basis: 'lid (open in the model) rotated closed about its back hinge line and fitted over the rim (local)',
    lidClose: {pred: c => c.min[1] > 0.425, pivot: [0.431, 0.249], angleDeg: -22.4, fit: {x: [-0.29, 0.29], z: [-0.292, 0.292]}}},
  // --- batch 2 ---
  // M29 (review/b2g2-*): its right-hand door is modelled swung open (adds depth / width) -> size by the cabinet height 1.9 m instead of
  // the frozen 1.2 m width.
  // Primary (recovery02): close that door locally. Manifest frame (frozen 1.2 m width): the door panel (20 tris, x -0.563..-0.539,
  // y 0.21..2.36, z -0.751..0.036) + 4 hardware pieces (134 tris total, none sharing vertices with the cabinet) are swung 90 deg forward
  // from a hinge at (x -0.551, z 0.036) = the cabinet's left front edge (build frame, front -Z). Rotated -90 deg about that line, its
  // 0.787 m width fitted x0.731 to the bay (x -0.585..-0.010, interior drawers + shelves behind it), hinge moved to x -0.585 (dx -0.034),
  // seated 18 mm proud of the drawer pulls (dz -0.066). Then uniform to 1.9 m tall.
  'medicine-drawer-cabinet': {basis: 'right door (open in the model) rotated closed about its hinge + width-fitted to its bay (local); uniform: cabinet height 1.9 m', sizeM: 1.9, sizeAxis: 'h',
    hingeClose: {pred: c => c.max[2] <= 0.04 && c.min[2] < -0.12 && c.min[0] > -0.61 && c.max[0] < -0.48, hinge: [-0.551, 0.036], sx: 0.731, dx: -0.034, dz: -0.066}},
  // --- batch 2 resume (recovery02, after the provider-limit pause) + 2R ---
  // M35 (review/b2r-refines-raw.png): 0.82 m deep at the frozen 1.8 m height (a gun safe is ~0.6 m) -> depth z x0.76.
  // Task mall-playtest-revision-20261031 (lane FIX, U06: "the new vault asset has flickering on the door / messed up triangles"): the raw
  // refine (and its preview) models the door face as two interleaved, partly overlapping front-facing tilings + 5 inward-facing triangles
  // all in ONE plane (runtime frame z -0.2354; ~0.75 m2 of overlap over ~40 % of the door) and the material is double-sided -> z-fighting.
  // dedupe (lib/coplanar-dedupe.mjs, final derivative frame, front -Z): one front layer over the old coverage (larger triangles keep their
  // texture, the others are clipped exactly around them; no hole / overlap), inward-facing duplicates dropped (the openable spec gives the
  // leaf an inner plate). The back plane (z +0.30, against the wall) had the same stacking: repaired the same way (front +Z).
  'gun-safe-tall': {basis: 'tall safe 1.8 m (frozen h), depth trimmed to 0.60 m (z x0.76); coplanar duplicate door / back layers removed (local)', scaleAxes: [[2, 0.76]],
    dedupe: [{box: {min: [-0.31, 0.12, -0.245], max: [0.31, 1.68, -0.225]}, axis: 2, facing: -1, tol: 0.001},
      {box: {min: [-0.42, -0.01, 0.29], max: [0.42, 1.81, 0.31]}, axis: 2, facing: 1, tol: 0.001}]},
  // M45: 4-drawer dresser at the frozen 1.4 m width stood 0.98 m tall and 0.94 m deep -> y x0.866, z x0.53 (0.85 x 0.50 m frozen).
  'dresser-drawers': {basis: 'dresser 1.4 x 0.85 x 0.50 m (frozen; per-axis y x0.866, z x0.53)', scaleAxes: [[1, 0.866], [2, 0.53]]},
  // M42: at the frozen 1.2 m width (incl. the cantilevered acrylic side tiers) it stood 2.48 m -> uniform to the frozen 2.2 m height.
  'cosmetics-wall-unit': {basis: 'uniform: unit height 2.2 m (frozen h; width incl. side acrylic tiers)', sizeM: 2.2, sizeAxis: 'h'},
  // M37: the model has a slim backrest; at the frozen 1.8 m the seat top stood ~0.48 m -> uniform 1.7 m long (seat ~0.45 m).
  'mall-bench': {basis: 'uniform: 1.7 m long so the slatted seat top is ~0.45 m', sizeM: 1.7, sizeAxis: 'w'},
  // M31: diameter == height in the model -> uniform to a 0.75 m table top (frozen h), diameter 0.75 m.
  'cafe-bistro-table': {basis: 'uniform: table top 0.75 m (frozen h)', sizeM: 0.75, sizeAxis: 'h'},
  // M30 (2R slot 85): open two-bay multideck 1.65 m tall at the frozen 1.9 m width -> y x1.2 (~1.98 m, frozen 2.0 m).
  // Task mall-round2-20261031 (lane PROPS, M04 — user: "the back of the 'cooler' prop has some messed up geometry"; label 'open cooler'):
  // measured in the final frame (front -Z) — the INNER back wall (z +0.340, seen through the open front) is a zero-thickness double sheet
  // (a -Z and a +Z layer in one plane over 78 % of the wall, double-sided material -> z-fighting) with two wedge-shaped HOLES (21 %, a
  // 'V', ~0.53 m2) onto the outer back shell 13 cm behind; the refine texture of the outer back (z +0.461..0.475) carries a painted ghost of the
  // shelves seen through that V; the 1.20 m shelf's centre-right segment is warped (front corner x 0.028, z -0.278 raised to 1.310).
  // panelRebuild: the wall slab (both layers + the shelves' rear strips in that plane, 56 tris) -> ONE quad facing the front, UV-mapped
  // onto a uniform 2.4 % patch of the wall's own texture island (base ~213/215/212, flat normal; no TANGENT attribute: UVs stay
  // non-degenerate). snap: the warped corner back onto the shelf plane (y 1.1952 at z -0.278). dedupe: the deck (0.474), the shelves
  // (0.73 / 0.955 underside / 0.97 / 1.20 / 1.49) and the roof top (1.934) are zero-thickness double sheets too (8.1 m2 of
  // opposite-facing overlap), some warped up to ~15 mm across a triangle and crossing each other: one up-facing layer kept per level
  // (tolerance 1.6 cm inside a strict per-level slab, only triangles within 11 deg of horizontal; 7 mm for the 0.955 underside /
  // 0.97 top pair, 1.7 cm apart; the 1.20 slab holds that shelf's warped bottom piece, which crosses its top) — positions unchanged:
  // the loot decks stay put.
  // panelGhosts: the outer back's painted V (only ~8-12 levels darker than its plain finish: a threshold catches fragments) — every texel
  // of the outer back inside the V's region refilled (all maps) by a clone stamp from the same face 0.45 m to the side (same height).
  'multideck-open-cooler': {basis: 'open multideck 1.9 m wide (frozen), height stretched to ~2.0 m (per-axis y x1.2); inner back wall rebuilt as one panel (holes + double sheet), warped shelf corner flattened, painted ghost on the outer back cleaned (local)',
    scaleAxes: [[1, 1.2]],
    panelRebuild: [{axis: 2, at: 0.3405, tol: 0.004, facing: -1, rect: [-0.918, 0.918, 0.538, 1.866], uv: {centre: [0.52464, 0.60894], perMetre: 0.0125}}],
    snap: [{box: {min: [0.02, 1.25, -0.29], max: [0.04, 1.32, -0.27]}, axis: 1, value: 1.1952}],
    // [slab lo, slab hi, plane tolerance, box z0] per level: the slab (strict) keeps each level off the lip undersides 1.5-1.7 cm below
    dedupe: [[0.462, 0.482, 0.016, -0.40], [0.7205, 0.745, 0.016, -0.30], [0.947, 0.962, 0.007, -0.30], [0.963, 0.98, 0.007, -0.30], [1.1855, 1.215, 0.016, -0.30],
      [1.48, 1.5, 0.016, -0.30], [1.925, 1.945, 0.003, -0.42]].map(([y0, y1, tol, z0]) => ({box: {min: [-0.95, y0, z0], max: [0.95, y1, y0 > 1.9 ? 0.47 : 0.35]}, axis: 1, facing: 1, tol,
      slab: [y0, y1], clipOpposite: true, minAxisCos: 0.98})),
    panelGhosts: [{axis: 2, at: 0.468, tol: 0.0085, facing: 1, region: {min: [-0.41, 0.52, 0.455], max: [0.41, 1.88, 0.49]}, all: true, clone: {along: 0, by: 0.45}}]},
};

// EXTRA assets (task mall-round3-20261031 / recovery01-20261101, lane SHOPS, R4): accepted Meshy models generated OUTSIDE the Track3
// frozen batches, each under its own user-approved task, ledger and raw folder (read-only). Cooked exactly like an M-code: sha-verified
// raw -> rotate the reviewed native front to -Z, uniform scale to sizeM along sizeAxis, grounded, centred, local `edits` (here: a
// meshoptimizer decimation to the M07-class triangle budget), the lean texture policy of its size tier. Provenance in `extraOutputs`
// (task ids / prompts / raw sha256 / credits from that task's ledger + manifest); registry / dims / allowlist / CREDITS like any output.
// Built when named in --only (or on a full run); otherwise reused when the raw, recipe and output are unchanged.
const EXTRA = {
  // R4 — user: "no female clothing store ... Make sure to make a female maniqune. This asset will be handy in other spots, because it will be
  // spooooky!". The primary's approved Meshy T2.5 job (1 attempt, 15 credits, accepted 2026-11-01; raw 0.238 x 0.951 x 0.191 m, faces +Z):
  // a glossy off-white fibreglass female mannequin with a featureless egg head on a round brushed-steel base plate + ankle rod. 10,488 tris
  // (target_polycount 10000) -> ~3k like M07 (weld + meshopt simplify, UV seams locked, error <= 1 % of the extent); uniform 1.75 m tall.
  M81: {id: 'mannequin-female', task: 'studio-beta-mall-round3-recovery01-20261101-01', lane: 'SHOPS (sub-lane SHOPS-MANNEQUIN, item R4); generated by the primary (sole Meshy submitter)',
    label: 'female full-figure display mannequin (featureless egg head, no clothing / face) on a round brushed-steel base plate + ankle rod',
    role: 'decor/movable', programs: ['womenswear', 'clothing', 'department'], placement: 'free', shopsKind: 'mannequinFemale', target: [0.44, 1.75, 0.35],
    dir: 'reference/tasks/mall-round3-recovery01-20261101/meshy', raw: 'raw/a1-refine-01a194aa.glb', rawSha256: '45667bd25a8d44977566cf9b7f141246ad7d76c1b61a82e95498397890c4ff0f',
    preview: 'raw/a1-preview-01a194a9.glb', previewSha256: '194679fe1634f50f5abb657dd9a59fa4a8227bab082bcf65832872f0382d92b2', front: '+Z',
    edits: {basis: 'uniform: 1.75 m tall incl. the base plate; decimated to the M07-class budget (~3k tris; UV seams locked)', sizeM: 1.75, sizeAxis: 'h',
      simplify: {targetTris: 3000, error: 0.01, lockBorder: true}}},
};

// ---------- records ----------
const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const freezes = ledger.filter(e => e.event === 'freeze');
const SPECS = new Map(); // code -> {spec (frozen attempt entry), batch, freezeSha}
for (const f of freezes) {
  const p = path.join(ASSETS_DIR, f.file);
  const buf = fs.readFileSync(p);
  if (sha(buf) !== f.sha256) throw new Error(`${f.file} changed after its freeze (${sha(buf)} != ${f.sha256}); refusing to build`);
  const b = JSON.parse(buf.toString());
  for (const a of b.attempts) {
    const prev = SPECS.get(a.code);
    if (prev && JSON.stringify(prev.spec.targetSize) !== JSON.stringify(a.targetSize)) throw new Error(`${a.code}: frozen size differs between batches`);
    if (!prev || !a.replacesAttempt) SPECS.set(a.code, {spec: a, batch: b.batch, freezeSha: f.sha256, frozenBy: b.frozenBy, frozenAt: b.frozenAt});
  }
}
// id collisions with the office / company library keys (the mall renders through `office-<id>` keys) or foreign public files
const companyIds = new Set([...fs.readFileSync(path.join(root, 'game/src/assets/companyDims.generated.ts'), 'utf8').matchAll(/^ {2}'([a-z0-9-]+)': /gm)].map(m => m[1]));
for (const [code, {spec}] of SPECS) {
  if (companyIds.has(spec.assetId)) throw new Error(`${code} ${spec.assetId}: id collides with a company asset (library key ${libraryKey(spec.assetId)})`);
  if (fs.existsSync(path.join(PUB, `assets/models/office-${spec.assetId}.glb`))) throw new Error(`${code} ${spec.assetId}: office-${spec.assetId}.glb exists (library key collision)`);
}

function jobsFor(code) {
  const ev = ledger.filter(e => e.code === code);
  const accepted = [...ev].reverse().find(e => e.event === 'inspect' && e.kind === 'refine' && e.verdict === 'accepted');
  const dl = accepted ? ev.find(e => e.event === 'download' && e.kind === 'refine' && e.task_id === accepted.task_id) : null;
  const refineAck = dl ? ev.find(e => e.event === 'ack' && e.kind === 'refine' && e.task_id === dl.task_id) : null;
  const previewId = refineAck?.preview_task_id ?? null;
  const previewDl = previewId ? ev.find(e => e.event === 'download' && e.kind === 'preview' && e.task_id === previewId) : null;
  const intentOf = ack => (ack ? ev.find(e => e.event === 'intent' && e.t === ack.intentT) : null);
  const previewAck = previewId ? ev.find(e => e.event === 'ack' && e.kind === 'preview' && e.task_id === previewId) : null;
  const scale = accepted ? [...ev].reverse().find(e => e.event === 'scale-review' && e.task_id === accepted.task_id) : null;
  const acks = ev.filter(e => e.event === 'ack');
  const rejects = ev.filter(e => e.event === 'reject');
  const failed = ev.filter(e => e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''));
  const seen = new Set(); let credits = 0;
  for (const e of ev) if ((e.event === 'download' || (e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''))) && !seen.has(e.task_id)) { seen.add(e.task_id); credits += e.consumed_credits ?? 0; }
  return {ev, accepted, dl, refineAck, previewDl, previewIntent: intentOf(previewAck), refineIntent: intentOf(refineAck), scale, acks, rejects, failed, credits};
}

// ---------- derive ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ROT = {'+Z': Math.PI, '-Z': 0, '+X': Math.PI / 2, '-X': -Math.PI / 2};
const sizeMOf = s => s.targetSize.sizeM, sizeAxisOf = s => s.targetSize.sizeAxis;

/**
 * Glass by COMPONENT (manifest frame): every connected component `pred(c)` selects (thin glass sheets modelled as their own pieces) moves
 * to one untextured transparent node 'glass' with the shop-cooler glass contract (lib/clutter-split.mjs GLASS_MATERIAL, BLEND, double
 * sided -> GLTFLoader transparent + depthWrite false, never a flashlight-shadow caster). Returns {tris, comps}.
 */
/**
 * Local repair (manifest frame): copies of the components `pred` selects, remapped linearly along x from [from0, from1] to [to0, to1]
 * (same material / UVs) — e.g. the hook-bar span that left with a removed, fused loose item. Returns the copied triangle count.
 */
function extendComps(doc, {pred, from, to}) {
  let tris = 0;
  for (const pc of components(doc)) {
    const sel = new Set(pc.comps.filter(c => pred({...c, ext: [0, 1, 2].map(k => c.max[k] - c.min[k])})).map(c => c.id));
    if (!sel.size) continue;
    const I = pc.prim.getIndices().getArray(), keep = [];
    for (let t = 0; t < I.length; t += 3) if (sel.has(pc.tri[t / 3])) keep.push(I[t], I[t + 1], I[t + 2]);
    const cp = pc.prim.clone();
    cp.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Uint32Array(keep)));
    compactPrimitive(cp);
    const k = (to[1] - to[0]) / (from[1] - from[0]);
    transformPrimitive(cp, [k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, to[0] - k * from[0], 0, 0, 1]);
    pc.mesh.addPrimitive(cp);
    tris += keep.length / 3;
  }
  if (!tris) throw new Error('extendComps: nothing selected');
  return tris;
}

/**
 * Local repair (manifest frame): a door modelled SWUNG OPEN 90 degrees, rotated CLOSED about its vertical hinge line. The components
 * `pred` selects (door panel + its hardware; their vertices are not shared with anything else) get, in order: rotation -90 deg about Y
 * through (hx, hz) [x' = hx - (z - hz), z' = hz + (x - hx)], a width fit sx along x about the hinge, then a shift (dx, dz). Normals /
 * tangents follow (rotation, then the inverse width scale, renormalised). Returns {tris, comps, verts}.
 */
function hingeCloseComps(doc, {pred, hinge: [hx, hz], sx = 1, dx = 0, dz = 0}) {
  let tris = 0, verts = 0; const comps = new Set();
  for (const pc of components(doc)) {
    const sel = new Set(pc.comps.filter(c => pred({...c, ext: [0, 1, 2].map(k => c.max[k] - c.min[k])})).map(c => c.id));
    if (!sel.size) continue;
    const I = pc.prim.getIndices().getArray(), mine = new Set(), other = new Set();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) (sel.has(pc.tri[t / 3]) ? mine : other).add(I[t + k]);
    for (const v of mine) if (other.has(v)) throw new Error('hingeCloseComps: a door vertex is shared with the cabinet');
    const P = pc.prim.getAttribute('POSITION'), N = pc.prim.getAttribute('NORMAL'), T = pc.prim.getAttribute('TANGENT');
    const p = [0, 0, 0], n = [0, 0, 0], q = [0, 0, 0, 0];
    const dir = (x, y, z) => { const a = [-z / sx, y, x], l = Math.hypot(...a) || 1; return a.map(c => c / l); };
    for (const v of mine) {
      P.getElement(v, p);
      P.setElement(v, [hx + dx - sx * (p[2] - hz), p[1], hz + dz + (p[0] - hx)]);
      if (N) { N.getElement(v, n); N.setElement(v, dir(n[0], n[1], n[2])); }
      if (T) { T.getElement(v, q); const d = dir(q[0], q[1], q[2]); T.setElement(v, [...d.map((c, i) => (i === 0 ? c * sx * sx : c)), q[3]].map((c, i, a) => (i < 3 ? c / (Math.hypot(a[0], a[1], a[2]) || 1) : c))); }
    }
    verts += mine.size;
    for (let t = 0; t < I.length; t += 3) if (sel.has(pc.tri[t / 3])) tris++;
    for (const id of sel) comps.add(id);
  }
  if (!tris) throw new Error('hingeCloseComps: nothing selected');
  return {tris, comps: comps.size, verts};
}

/**
 * Local repair (manifest frame): a LID modelled raised open, rotated CLOSED about its horizontal hinge line along X through (py, pz) by
 * angleDeg (right-handed about +X), then the selected vertices are fitted linearly onto `fit` ({x: [x0, x1], z: [z0, z1]} target ranges;
 * y kept) and shifted by dy. Normals / tangents follow (rotation, then the inverse fit scale, renormalised). The selected components
 * must share no vertex with the rest (checked). Returns {tris, comps, verts, angleDeg, before / after bounds}.
 */
function lidCloseComps(doc, {pred, pivot: [py, pz], angleDeg, fit = {}, dy = 0}) {
  const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const work = [];
  for (const pc of components(doc)) {
    const sel = new Set(pc.comps.filter(c => pred({...c, ext: [0, 1, 2].map(k => c.max[k] - c.min[k])})).map(c => c.id));
    if (!sel.size) continue;
    const I = pc.prim.getIndices().getArray(), mine = new Set(), other = new Set();
    let tris = 0;
    for (let t = 0; t < I.length; t += 3) { const m = sel.has(pc.tri[t / 3]); if (m) tris++; for (let k = 0; k < 3; k++) (m ? mine : other).add(I[t + k]); }
    for (const v of mine) if (other.has(v)) throw new Error('lidCloseComps: a lid vertex is shared with the box');
    work.push({pc, mine, tris, n: sel.size});
  }
  if (!work.length) throw new Error('lidCloseComps: nothing selected');
  const rot = p => [p[0], py + (p[1] - py) * ca - (p[2] - pz) * sa, pz + (p[1] - py) * sa + (p[2] - pz) * ca];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], before = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  const p = [0, 0, 0];
  for (const {pc, mine} of work) { const P = pc.prim.getAttribute('POSITION'); for (const v of mine) { P.getElement(v, p);
    for (let k = 0; k < 3; k++) { before.min[k] = Math.min(before.min[k], p[k]); before.max[k] = Math.max(before.max[k], p[k]); }
    const r = rot(p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], r[k]); hi[k] = Math.max(hi[k], r[k]); } } }
  const S = [fit.x ? (fit.x[1] - fit.x[0]) / (hi[0] - lo[0]) : 1, 1, fit.z ? (fit.z[1] - fit.z[0]) / (hi[2] - lo[2]) : 1];
  const O = [fit.x ? fit.x[0] - S[0] * lo[0] : 0, dy, fit.z ? fit.z[0] - S[2] * lo[2] : 0];
  const dirT = d => { const r = [d[0], d[1] * ca - d[2] * sa, d[1] * sa + d[2] * ca]; const q = [r[0] / S[0], r[1], r[2] / S[2]]; const l = Math.hypot(...q) || 1; return q.map(c => c / l); };
  const after = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  let verts = 0, tris = 0, comps = 0; const n = [0, 0, 0], q = [0, 0, 0, 0];
  for (const {pc, mine, tris: t, n: cn} of work) {
    const P = pc.prim.getAttribute('POSITION'), N = pc.prim.getAttribute('NORMAL'), T = pc.prim.getAttribute('TANGENT');
    for (const v of mine) {
      P.getElement(v, p); const r = rot(p); const w = [S[0] * r[0] + O[0], r[1] + O[1], S[2] * r[2] + O[2]];
      P.setElement(v, w); for (let k = 0; k < 3; k++) { after.min[k] = Math.min(after.min[k], w[k]); after.max[k] = Math.max(after.max[k], w[k]); }
      if (N) { N.getElement(v, n); N.setElement(v, dirT(n)); }
      if (T) { T.getElement(v, q); const r2 = [q[0], q[1] * ca - q[2] * sa, q[1] * sa + q[2] * ca]; const m = [r2[0] * S[0], r2[1], r2[2] * S[2]]; const l = Math.hypot(...m) || 1; T.setElement(v, [m[0] / l, m[1] / l, m[2] / l, q[3]]); }
    }
    verts += mine.size; tris += t; comps += cn;
  }
  const r4 = b => ({min: b.min.map(x => +x.toFixed(4)), max: b.max.map(x => +x.toFixed(4))});
  return {tris, comps, verts, angleDeg, fitScale: S.map(x => +x.toFixed(4)), before: r4(before), after: r4(after)};
}

/** Local procedural part: an axis-aligned untextured box (own material) as node `name` — e.g. a belt deck over a modelled trough. */
function addBox(doc, {min, max, color, roughness = 0.85, metallic = 0, name = 'box'}) {
  const P = [], N = [], I = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, base = P.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const q = [0, 0, 0]; q[ax] = sg > 0 ? max[ax] : min[ax]; q[u] = a ? max[u] : min[u]; q[v] = b ? max[v] : min[v];
      P.push(...q); const n = [0, 0, 0]; n[ax] = sg; N.push(...n);
    }
    I.push(...(sg > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  const buf = doc.getRoot().listBuffers()[0];
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(P)))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(N)))
    .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint32Array(I)))
    .setMaterial(doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(metallic));
  (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return {min, max};
}

function splitGlassComps(doc, pred) {
  const pcs = components(doc);
  let tris = 0; const comps = new Set();
  for (const pc of pcs) {
    const sel = new Set(pc.comps.filter(c => pred({...c, ext: [0, 1, 2].map(k => c.max[k] - c.min[k])})).map(c => c.id));
    if (!sel.size) continue;
    const I = pc.prim.getIndices().getArray(), glass = [], rest = [];
    for (let t = 0; t < I.length; t += 3) (sel.has(pc.tri[t / 3]) ? glass : rest).push(I[t], I[t + 1], I[t + 2]);
    if (!glass.length) continue;
    const gp = pc.prim.clone();
    pc.prim.getIndices().setArray(new Uint32Array(rest)); compactPrimitive(pc.prim);
    gp.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Uint32Array(glass)));
    for (const sem of gp.listSemantics()) if (sem !== 'POSITION' && sem !== 'NORMAL') gp.setAttribute(sem, null);
    const G = GLASS_MATERIAL;
    gp.setMaterial(doc.createMaterial(`${pc.prim.getMaterial().getName()}-glass`).setBaseColorFactor(G.baseColor).setAlphaMode('BLEND').setDoubleSided(true)
      .setRoughnessFactor(G.roughness).setMetallicFactor(G.metallic));
    compactPrimitive(gp);
    const node = doc.createNode('glass').setMesh(doc.createMesh(`${pc.mesh.getName()}-glass`).addPrimitive(gp));
    (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).addChild(node);
    tris += glass.length / 3; for (const id of sel) comps.add(id);
  }
  if (!tris) throw new Error('splitGlassComps: no glass component selected');
  return {tris, comps: comps.size};
}

async function derive(spec, rawBytes, front, [basePx, otherPx, quality], edOverride) { // edOverride: the edits of an EXTRA asset (instead of EDITS[id])
  const id = spec.assetId;
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const th = ROT[front];
  const c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
  const e0 = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
  const ext = [Math.abs(c) * e0[0] + Math.abs(sn) * e0[2], e0[1], Math.abs(sn) * e0[0] + Math.abs(c) * e0[2]];
  const axis = sizeAxisOf(spec);
  const ref = axis === 'h' ? ext[1] : axis === 'w' ? ext[0] : Math.max(...ext);
  const s = sizeMOf(spec) / ref;
  const R = [s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, 0, 0, 0, 1]; // column-major p' = s * rotY(th) * p
  for (const m of r.listMeshes()) transformMesh(m, R);
  const b1 = getBounds(scene);
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1];
  for (const m of r.listMeshes()) transformMesh(m, T);
  const E = edOverride !== undefined ? edOverride : EDITS[id];
  let k = 1, split = null, glass = null, ghosts = null;
  const parts = [], edits = {};
  if (E) {
    // (lane SHOPS, R4) an EXTRA asset's decimation (weld + meshopt simplify, UV seams locked; textures untouched), in the final frame
    if (E.simplify) {
      const triCount = () => r.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
      const before = triCount(), ratio = Math.min(1, E.simplify.targetTris / before);
      await doc.transform(weld({tolerance: 0.0001}), simplify({simplifier: MeshoptSimplifier, ratio, error: E.simplify.error, lockBorder: E.simplify.lockBorder}));
      edits.simplified = {before, after: triCount(), ratio: +ratio.toFixed(6), ...E.simplify, simplifier: 'meshoptimizer (gltf-transform simplify), weld tolerance 1e-4'};
    }
    if (E.parts) split = await splitClutter(doc, E);
    if (E.extend) for (const x of E.extend) (edits.extended ??= []).push({from: x.from, to: x.to, tris: extendComps(doc, x)});
    if (E.lidClose) edits.lidClosed = lidCloseComps(doc, E.lidClose);
    if (E.hingeClose) edits.hingeClosed = {...hingeCloseComps(doc, E.hingeClose), hinge: E.hingeClose.hinge, sx: E.hingeClose.sx, dx: E.hingeClose.dx, dz: E.hingeClose.dz};
    if (E.glass) glass = await splitGlass(doc, sharp, E.glass);
    if (E.glassComps) glass = splitGlassComps(doc, E.glassComps);
    if (E.supports) ghosts = await cleanSupportTexture(doc, sharp, E.supports, E.ghostThresh ?? 34, null);
    // furniture-only proportion edit: per-axis scale about the centred / grounded manifest frame, re-grounded (office lane-FURN scaleX)
    if (E.scaleAxes) { for (const [ax, f] of E.scaleAxes) scaleAxis(doc, ax, f); scaleGroundCentre(doc, 1); }
    if (E.boxes) edits.boxes = E.boxes.map(b => addBox(doc, b)); // post-scale frame (inside the bounds: grounding unchanged)
    if (E.sizeM) {
      const bb = getBounds(scene);
      k = E.sizeM / extentOf(bb, E.sizeAxis);
      scaleGroundCentre(doc, k);
    } else scaleGroundCentre(doc, 1); // removed clutter / split glass can shift the bounds: re-ground and re-centre
    // (lane PROPS, M04) broken flat panels, in the final frame (measured on the delivered derivative; bounds unchanged): rebuild a
    // panel's slab as one clean quad, snap warped vertices back onto their plane (before the dedupe of that plane)
    if (E.panelRebuild) edits.panelRebuild = E.panelRebuild.map(p => rebuildPanel(doc, p));
    if (E.snap) edits.snapped = E.snap.map(p => snapVertices(doc, p));
    // (lane FIX, U06) coplanar duplicate layers, in the final frame (boxes measured on the delivered derivative; bounds unchanged)
    if (E.dedupe) edits.coplanarDedupe = E.dedupe.map(d => dedupeCoplanar(doc, d));
    // (lane PROPS, M04) a ghost painted into a face's texture (the refine baked the view through the holes onto the outer back)
    if (E.panelGhosts) { edits.panelGhosts = []; for (const g of E.panelGhosts) edits.panelGhosts.push(await cleanPanelGhosts(doc, sharp, g)); }
    for (const p of split?.parts ?? []) {
      const pr = p.doc.getRoot();
      pr.listMeshes().forEach((m, i) => m.setName(i ? `${p.id}-${i}` : p.id));
      pr.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${p.id}-${i}` : p.id));
      pr.listMaterials().forEach((m, i) => m.setName(i ? `mall-${p.id}-${i}` : `mall-${p.id}`));
      const crop = await cropPartTextures(p.doc, sharp, PART_TEX_PX, PART_TEX_Q);
      pr.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-mall-track3.mjs + lib/clutter-split.mjs (glTF-Transform)';
      parts.push({id: p.id, glb: Buffer.from(await io.writeBinary(p.doc)), tris: p.tris, scale: s * p.scale, crop});
    }
  }
  // names: '<id>' meshes / nodes, 'mall-<id>' materials; a separated transparent 'glass' node keeps /glass/ (damage/materials.ts partKeyClass)
  const kept = nm => /glass|^belt$/.test(nm);
  r.listMeshes().filter(m => !kept(m.getName())).forEach((m, i) => m.setName(i ? `${id}-${i}` : id));
  r.listNodes().filter(n => n.getMesh() && !kept(n.getName())).forEach((n, i) => n.setName(i ? `${id}-${i}` : id));
  r.listMaterials().filter(m => !/-glass$|^belt$/.test(m.getName())).forEach((m, i) => m.setName(i ? `mall-${id}-${i}` : `mall-${id}`));
  for (const m of r.listMaterials().filter(q => q.getName() === 'belt')) m.setName(`mall-${id}-belt`);
  for (const m of r.listMaterials().filter(q => /-glass$/.test(q.getName()))) m.setName(`mall-${id}-glass`);
  for (const m of r.listMeshes().filter(q => /glass/.test(q.getName()))) m.setName(`${id}-glass`);
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [basePx, basePx], quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [otherPx, otherPx], quality, slots: /^(?!baseColor)/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-mall-track3.mjs (glTF-Transform)';
  return {glb: Buffer.from(await io.writeBinary(doc)), scale: s * k, rawExtent: e0, parts, edits: E ? {k, removed: split?.removed ?? null, glass, ghosts, ...edits} : null};
}

async function measure(glb) {
  const d = await io.readBinary(new Uint8Array(glb));
  const b = getBounds(d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(k => +(b.max[k] - b.min[k]).toFixed(4));
  const tris = d.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const textures = d.getRoot().listTextures().map(t => {
    const slot = d.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  const gpuBytes = textures.reduce((s2, t) => s2 + (t.size ? Math.round(t.size[0] * t.size[1] * 4 * 4 / 3) : 0), 0);
  return {b, dims, tris, textures, gpuBytes};
}
function checkGrounded(id, b, sizeM) {
  if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 * sizeM || Math.abs(b.min[2] + b.max[2]) > 1e-3 * sizeM) throw new Error(`${id} not grounded/centred`);
}
const tokenCheck = (id, buf) => {
  const json = buf.subarray(20, 20 + buf.readUInt32LE(12)).toString();
  if (/https?:|Signature=|X-Amz|Key-Pair-Id|token=/i.test(json)) throw new Error(`URL/token-like string inside ${id} glTF JSON`);
};

// ---------- fixture (dry-run pipeline exercise; writes only to /tmp) ----------
if (FIXTURE) {
  const spec = manifest.slots.find(s => s.code === FIXTURE_CODE);
  if (!spec) throw new Error(`--fixture-code ${FIXTURE_CODE} not in the manifest`);
  const rawBytes = fs.readFileSync(FIXTURE);
  const tier = tierOf(spec), T = POLICIES[POLICY].tiers[tier];
  let out, step;
  for (step = 0; step < T.ladder.length; step++) { out = await derive(spec, rawBytes, FIXTURE_FRONT, T.ladder[step]); if (out.glb.length <= T.budget) break; }
  step = Math.min(step, T.ladder.length - 1);
  tokenCheck(spec.assetId, out.glb);
  const m = await measure(out.glb);
  checkGrounded(spec.assetId, m.b, sizeMOf(spec));
  const got = sizeAxisOf(spec) === 'h' ? m.dims[1] : sizeAxisOf(spec) === 'w' ? m.dims[0] : Math.max(...m.dims);
  if (Math.abs(got - sizeMOf(spec)) > 2e-3) throw new Error(`fixture not at its real size (${got} != ${sizeMOf(spec)})`);
  const dir = '/tmp/track3-fixture';
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `mall-${spec.assetId}.glb`);
  fs.writeFileSync(file, out.glb);
  const rep = {fixture: true, NOT_A_DELIVERY: 'pipeline exercise on a local stand-in GLB; never copied to game/public', input: path.relative(root, path.resolve(FIXTURE)), inputSha256: sha(rawBytes),
    code: spec.code, id: spec.assetId, policy: POLICY, tier, textureStep: step, ladder: T.ladder[step], budget: T.budget, bytes: out.glb.length, overBudget: out.glb.length > T.budget,
    dims: m.dims, sizeM: sizeMOf(spec), sizeAxis: sizeAxisOf(spec), tris: m.tris, trisAcceptMax: spec.tris.acceptMax, gpuBytes: m.gpuBytes, textures: m.textures.map(t => ({slot: t.slot, size: t.size, bytes: t.bytes})),
    scale: +out.scale.toFixed(6), rawExtent: out.rawExtent.map(v => +v.toFixed(4)), out: file};
  fs.writeFileSync(path.join(dir, `mall-${spec.assetId}.report.json`), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

// ---------- build every accepted asset of the frozen batches ----------
const prevProv = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : null;
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const outputs = [], missing = [];
for (const [code, {spec, batch, freezeSha, frozenBy, frozenAt}] of [...SPECS].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const id = spec.assetId;
  const j = jobsFor(code);
  if (!j.dl) {
    missing.push({code, id, batch, reason: j.failed.length && !j.acks.some(x => x.kind === 'refine') ? `generation failed (${j.failed.map(f => f.status).join(', ')})`
      : j.acks.some(x => x.kind === 'refine') ? 'refine submitted, not accepted / delivered yet' : j.acks.some(x => x.kind === 'preview') ? 'preview only' : 'not generated yet'});
    continue;
  }
  const rawPath = path.join(ASSETS_DIR, j.dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== j.dl.sha256) throw new Error(`raw sha mismatch for ${id}: ${j.dl.file}`);
  const front = j.accepted.front;
  if (!(front in ROT)) throw new Error(`${id}: bad front ${front}`);
  const outRel = outRelOf(id), outAbs = path.join(PUB, outRel);
  const prevMine = prevProv?.outputs?.some(o => o.output.url === outRel);
  if (fs.existsSync(outAbs) && allow.files.some(f => f.path === outRel) && !prevMine) throw new Error(`${outRel} exists and is not this task's file`);
  const tier = tierOf(spec), T = POLICIES[POLICY].tiers[tier];
  const reuse = ONLY && !ONLY.has(code) && fs.existsSync(outAbs) && prevProv?.outputs?.find(o => o.id === id && o.source.sha256 === j.dl.sha256 && o.policy === POLICY && o.output.sha256 === sha(fs.readFileSync(outAbs)));
  let glb, scale, rawExtent, step, parts = [], edits = null;
  if (reuse) {
    glb = fs.readFileSync(outAbs); scale = reuse.scale; rawExtent = reuse.source.extent; step = reuse.textureStep;
    parts = (reuse.parts ?? []).map(q => ({id: q.id, glb: fs.readFileSync(path.join(PUB, q.output.url)), tris: q.output.triangles, scale: q.scale, crop: q.textureCrop}));
    edits = reuse.edits ?? null;
  } else {
    for (step = 0; step < T.ladder.length; step++) { ({glb, scale, rawExtent, parts, edits} = await derive(spec, rawBytes, front, T.ladder[step])); if (glb.length <= T.budget) break; }
    step = Math.min(step, T.ladder.length - 1);
    for (const q of [glb, ...parts.map(p => p.glb)]) tokenCheck(id, q);
    if (!DRY) {
      fs.writeFileSync(outAbs, glb);
      for (const q of parts) {
        const rel = partRelOf(q.id), abs = path.join(PUB, rel);
        const mine = prevProv?.outputs?.some(o => (o.parts ?? []).some(x => x.output.url === rel));
        if (fs.existsSync(abs) && allow.files.some(f => f.path === rel) && !mine) throw new Error(`${rel} exists and is not this pipeline's file`);
        fs.writeFileSync(abs, q.glb);
      }
    }
  }
  const m = await measure(glb);
  const E = EDITS[id];
  const sizeM = E?.sizeM ?? sizeMOf(spec), sizeAxis = E?.sizeAxis ?? sizeAxisOf(spec);
  checkGrounded(id, m.b, sizeM);
  const partOut = [];
  for (const q of parts) {
    const P = E.parts[q.id], pm = await measure(q.glb);
    checkGrounded(q.id, pm.b, P.sizeM);
    partOut.push({id: q.id, label: P.label, sizeM: P.sizeM, sizeAxis: P.sizeAxis, scale: +q.scale.toFixed(6), selection: P.box, textureCrop: q.crop,
      output: {file: `game/public/${partRelOf(q.id)}`, url: partRelOf(q.id), sha256: sha(q.glb), bytes: q.glb.length, triangles: pm.tris, dims: pm.dims}});
  }
  const rawDoc = await io.readBinary(new Uint8Array(rawBytes));
  const rawTris = rawDoc.getRoot().listMeshes().reduce((s2, mm) => s2 + mm.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const rawTex = rawDoc.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  const attempts = j.acks.map(x => ({kind: x.kind, task: x.task_id, slot: x.slot, attemptId: x.attemptId,
    ...(j.rejects.find(r => r.task_id === x.task_id) ? {rejected: j.rejects.find(r => r.task_id === x.task_id).reason} : {}),
    ...(j.failed.find(f => f.task_id === x.task_id) ? {status: j.failed.find(f => f.task_id === x.task_id).status} : {})}));
  outputs.push({code, id, key: libraryKey(id), batch, freezeSha256: freezeSha, frozenBy, frozenAt, category: spec.category, priority: spec.priority, role: spec.role, programs: spec.programs,
    shopsKind: spec.shopsKind?.kind ?? null, interaction: spec.interaction, placement: spec.placement,
    model: 'meshy-t2.5', modelType: 'smart-topology', topology: 'triangle', route: 'text-to-3d preview (geometry, 5 credits) + refine (2K PBR texture, 10 credits, inherits the T2.5 preview model)',
    previewPrompt: j.previewIntent?.args.prompt ?? spec.preview.args.prompt, texturePrompt: j.refineIntent?.args.texture_prompt ?? spec.refine.args.texture_prompt,
    previewArgs: j.previewIntent ? (({prompt: _p, response_format: _r, ...rest}) => rest)(j.previewIntent.args) : null,
    refineArgs: j.refineIntent ? (({texture_prompt: _t, preview_task_id: _i, response_format: _r, ...rest}) => ({...rest, ai_model: 'omitted (inherits the T2.5 preview)'}))(j.refineIntent.args) : null,
    tasks: {preview: j.refineAck.preview_task_id, refine: j.dl.task_id}, credits: {preview: j.previewDl?.consumed_credits ?? null, refine: j.dl.consumed_credits ?? null},
    creditsAllAttempts: j.credits, attempts,
    source: {file: `${TASK_DIR}/assets/${j.dl.file} (raw original, outside Git)`, sha256: j.dl.sha256, bytes: j.dl.bytes, triangles: rawTris, extent: rawExtent.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: j.previewDl ? `${TASK_DIR}/assets/${j.previewDl.file}` : null, previewSha256: j.previewDl?.sha256 ?? null, previewTriangles: j.previewDl?.glb?.tris ?? null},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: m.tris, dims: m.dims, overBudget: glb.length > T.budget,
      overTris: m.tris > (spec.tris?.acceptMax ?? Infinity), gpuTextureBytes: m.gpuBytes},
    targetTriangles: spec.tris?.target ?? null, targetSize: spec.targetSize, sizeM, sizeAxis, scale: +scale.toFixed(6), nativeFront: front,
    policy: POLICY, tier, textureStep: step, textureSizes: {baseColor: T.ladder[step][0], other: T.ladder[step][1], jpegQuality: T.ladder[step][2]}, budget: T.budget,
    transform: `rotateY(${({'+Z': '180', '-Z': '0', '+X': '90', '-X': '-90'})[front]}deg) * uniform scale to ${sizeMOf(spec)} m (${sizeAxisOf(spec)}), grounded (min y = 0), centred on x/z; baked into vertices${E ? '; local edits (EDITS): ' + Object.keys(E).join(', ') : ''}`, front: '-Z', up: '+Y',
    review: {evidence: j.accepted.evidence ?? null, checks: j.accepted.checks ?? null, rule4: j.accepted.rule4 ?? null, scale: j.scale ? {verdict: j.scale.verdict, notes: j.scale.notes, evidence: j.scale.evidence} : null},
    ...(NOTES[id] ? {note: NOTES[id]} : {}), textures: m.textures,
    ...(edits ? {edits: {...edits, ...(edits.glass ? {glassMaterial: {...GLASS_MATERIAL, alphaMode: 'BLEND', doubleSided: true}, glassContract: 'transparent, depthWrite false, never a flashlight-shadow caster (shop-cooler glass contract)'} : {})}} : {}),
    ...(partOut.length ? {parts: partOut} : {})});
  console.log(`${code} ${id}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e3).toFixed(0)} kB (${POLICY} ${tier} step ${step}), dims ${m.dims.join(' x ')}${glb.length > T.budget ? '  OVER BUDGET' : ''}${reuse ? ' (reused)' : ''}${DRY ? ' (dry-run: not written)' : ''}`);
}

// ---------- EXTRA assets (lane SHOPS, R4): accepted models outside the Track3 frozen batches, own task / ledger / raw folder ----------
const extraOut = [];
for (const [xcode, X] of Object.entries(EXTRA).sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (SPECS.has(xcode) || [...SPECS.values()].some(x => x.spec.assetId === X.id)) throw new Error(`${xcode} ${X.id}: collides with a frozen Track3 asset`);
  if (companyIds.has(X.id) || fs.existsSync(path.join(PUB, `assets/models/office-${X.id}.glb`))) throw new Error(`${xcode} ${X.id}: library key collision`);
  const dir = path.join(root, X.dir), E = X.edits;
  // records (read-only): raw sha == the pinned constant == the task's RAW-SHA256.txt; task ids / credits from its ledger; prompts from its manifest
  const rawBytes = fs.readFileSync(path.join(dir, X.raw)), previewBytes = fs.readFileSync(path.join(dir, X.preview));
  const listed = new Map(fs.readFileSync(path.join(dir, 'RAW-SHA256.txt'), 'utf8').split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)).map(([h, f]) => [f, h]));
  if (sha(rawBytes) !== X.rawSha256 || listed.get(path.basename(X.raw)) !== X.rawSha256) throw new Error(`${xcode}: raw ${X.raw} sha mismatch (constant / RAW-SHA256.txt)`);
  if (sha(previewBytes) !== X.previewSha256 || listed.get(path.basename(X.preview)) !== X.previewSha256) throw new Error(`${xcode}: preview ${X.preview} sha mismatch`);
  const xl = fs.readFileSync(path.join(dir, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const acc = xl.filter(e => e.event === 'accept');
  if (acc.length !== 1) throw new Error(`${xcode}: expected exactly one accept event in ${X.dir}/LEDGER.jsonl`);
  const tasks = {preview: acc[0].preview_task_id, refine: acc[0].task_id};
  const billedOf = id => xl.find(e => e.event === 'status' && e.task_id === id && /SUCCEEDED/.test(e.status ?? ''))?.consumed_credits ?? null;
  const credits = {preview: billedOf(tasks.preview), refine: billedOf(tasks.refine)};
  const xman = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
  const approvalSha256 = xl.find(e => e.event === 'open')?.approvalSha256 ?? null;
  const front = X.front;
  if (!(front in ROT)) throw new Error(`${xcode}: bad front ${front}`);
  const spec = {assetId: X.id, code: xcode, targetSize: {w: X.target[0], h: X.target[1], d: X.target[2], sizeM: E.sizeM, sizeAxis: E.sizeAxis}};
  const outRel = outRelOf(X.id), outAbs = path.join(PUB, outRel);
  const prevX = prevProv?.extraOutputs?.find(o => o.id === X.id);
  if (fs.existsSync(outAbs) && allow.files.some(f => f.path === outRel) && !prevX) throw new Error(`${outRel} exists and is not this pipeline's file`);
  const recipeSha256 = sha(JSON.stringify({extra: X}));
  const tier = tierOf(spec), T = POLICIES[POLICY].tiers[tier];
  const reuse = ONLY && !ONLY.has(xcode) && fs.existsSync(outAbs) && prevX && prevX.source.sha256 === X.rawSha256 && prevX.recipeSha256 === recipeSha256 && prevX.policy === POLICY
    && prevX.output.sha256 === sha(fs.readFileSync(outAbs)) ? prevX : null;
  let glb, scale, step, rawExtent, edits;
  if (reuse) { glb = fs.readFileSync(outAbs); scale = reuse.scale; step = reuse.textureStep; rawExtent = reuse.source.extent; edits = reuse.edits; }
  else {
    for (step = 0; step < T.ladder.length; step++) { ({glb, scale, rawExtent, edits} = await derive(spec, rawBytes, front, T.ladder[step], E)); if (glb.length <= T.budget) break; }
    step = Math.min(step, T.ladder.length - 1);
    tokenCheck(X.id, glb);
    if (!DRY) fs.writeFileSync(outAbs, glb);
  }
  const m = await measure(glb);
  checkGrounded(X.id, m.b, E.sizeM);
  if (Math.abs(extentOf(m.b, E.sizeAxis) - E.sizeM) > 2e-3) throw new Error(`${xcode} not at its real size (${extentOf(m.b, E.sizeAxis)} != ${E.sizeM})`);
  const rawDoc = await io.readBinary(new Uint8Array(rawBytes));
  const rawTris = rawDoc.getRoot().listMeshes().reduce((s2, mm) => s2 + mm.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const rawTex = rawDoc.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  extraOut.push({code: xcode, id: X.id, key: libraryKey(X.id), task: X.task, lane: X.lane, label: X.label, role: X.role, programs: X.programs, placement: X.placement, shopsKind: X.shopsKind,
    model: 'meshy-t2.5', modelType: xman.request.preview.model_type, topology: xman.request.preview.topology,
    route: 'text-to-3d preview (geometry, 5 credits) + refine (2K PBR texture, 10 credits, inherits the T2.5 preview model); generated by the primary (sole submitter) under the user\'s round-3 approval',
    previewPrompt: xman.request.preview.prompt_a1, texturePrompt: xman.request.refine.texture_prompt,
    previewArgs: (({prompt_a1: _p, tool: _t, ...rest}) => rest)(xman.request.preview), refineArgs: (({texture_prompt: _t, tool: _u, ...rest}) => rest)(xman.request.refine),
    tasks, credits, approvalSha256, records: {dir: `${X.dir} (outside Git)`, ledger: 'LEDGER.jsonl (accept / status events)', manifest: 'MANIFEST.json', rawSha256List: 'RAW-SHA256.txt'},
    source: {file: `${X.dir}/${X.raw} (raw original, outside Git; read-only)`, sha256: X.rawSha256, bytes: rawBytes.length, triangles: rawTris, extent: rawExtent.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: `${X.dir}/${X.preview}`, previewSha256: X.previewSha256},
    recipe: {rebuild: `node tools/asset-pipeline/props/build-mall-track3.mjs --only ${xcode} --no-delivered`, basis: E.basis}, recipeSha256,
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: m.tris, dims: m.dims, overBudget: glb.length > T.budget, gpuTextureBytes: m.gpuBytes},
    targetSize: spec.targetSize, target: X.target, sizeM: E.sizeM, sizeAxis: E.sizeAxis, scale: +scale.toFixed(6), nativeFront: front,
    policy: POLICY, tier, textureStep: step, textureSizes: {baseColor: T.ladder[step][0], other: T.ladder[step][1], jpegQuality: T.ladder[step][2]}, budget: T.budget,
    transform: `rotateY(${({'+Z': '180', '-Z': '0', '+X': '90', '-X': '-90'})[front]}deg) * uniform scale to ${E.sizeM} m (${E.sizeAxis}), grounded (min y = 0), centred on x/z; baked into vertices; local edits: ${Object.keys(E).join(', ')}`, front: '-Z', up: '+Y',
    edits, textures: m.textures});
  console.log(`${xcode} ${X.id} (extra: ${X.task}): ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e3).toFixed(0)} kB (${POLICY} ${tier} step ${step}), ${m.tris} tris, dims ${m.dims.join(' x ')}${glb.length > T.budget ? '  OVER BUDGET' : ''}${reuse ? ' (reused)' : ''}${DRY ? ' (dry-run: not written)' : ''}`);
}

// ---------- credits / authority summary (whole task, from the ledger) ----------
const billed = new Map();
for (const e of ledger) if ((e.event === 'download' || e.event === 'status') && e.task_id && typeof e.consumed_credits === 'number') billed.set(e.task_id, {kind: e.kind, credits: e.consumed_credits});
const rejectedTasks = new Set(ledger.filter(e => e.event === 'reject').map(e => e.task_id));
const creditSummary = {previews: 0, refines: 0, rejectedOrReplacedAttempts: 0, total: 0};
for (const [tid, v] of billed) { creditSummary[v.kind === 'preview' ? 'previews' : 'refines'] += v.credits; if (rejectedTasks.has(tid)) creditSummary.rejectedOrReplacedAttempts += v.credits; creditSummary.total += v.credits; }
const notCreated = new Set(ledger.filter(e => e.event === 'reconciled' && e.created === false).map(e => e.intentT));
const liveIntents = ledger.filter(e => e.event === 'intent' && !notCreated.has(e.t));
const authorityUse = {attempts: new Set(liveIntents.filter(e => e.kind === 'preview').map(e => e.slot)).size, posts: liveIntents.length,
  max: {attempts: 100, credits: 1500, posts: 200}};
const replacements = ledger.filter(e => e.event === 'intent' && e.replacement).map(e => ({code: e.code, slot: e.slot, ...e.replacement}));

// ---------- provenance ----------
const prov = {schema: 'last-line-derivative/1', asset: 'mall-track3-20261031', task: TASK, lane: 'ASSETS (Studio Beta Track3, sole Meshy submitter)',
  status: 'runtime derivatives of NEW mall-art models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP under the user\'s finite authorization for Track3 (<= 100 attempts incl. replacements, <= 1500 credits, <= 200 generation POSTs; staged batches frozen by the primary); provider terms apply; unapproved prototypes, no licence or commercial clearance implied',
  rebuild: `node tools/asset-pipeline/props/build-mall-track3.mjs --policy ${POLICY}`,
  rawStorage: `${TASK_DIR}/assets/raw/<id>/<attemptId>/{preview,refine}/ (immutable native GLBs, task status JSON, thumbnails) + ${TASK_DIR}/assets/ledger.jsonl (fsynced intent / ack / status / download / inspect / scale records) + batch-<n>.frozen.json (sha256 in the ledger freeze lines); outside Git`,
  convention: 'metres at real size (sizeM along sizeAxis), +Y up, front -Z, grounded (min y = 0), centred on x/z; library key office-<id> (SHOPS mall kinds render through the office prop path); level-only by path (assets/models/mall-*.glb)',
  texturePolicy: {policy: POLICY, tierFromM: POLICIES[POLICY].L, tiers: POLICIES[POLICY].tiers},
  modelProof: {requested: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', topology: 'triangle', target_formats: ['glb'], refine: 'texture_resolution 2k, enable_pbr true, ai_model omitted (inherits the preview model)'},
    evidence: ['exact create arguments copied from the sha-verified frozen batch into the fsynced ledger intent line before every paid call; ack with the returned task id right after',
      'every preview billed 5 credits (T2 / T2.5 / 6-lite tier; meshy-6 / 7.1 / latest bill 20) and returned a triangle-only mesh near target_polycount (smart topology) — checked before its refine',
      'the Meshy task GET response does not echo ai_model / model_type, so the request record + billing tier are the model proof']},
  freezes: freezes.map(f => ({batch: f.batch, file: f.file, sha256: f.sha256, frozenBy: f.frozenBy, frozenAt: f.frozenAt, attempts: f.attempts, credits: f.credits})),
  credits: creditSummary, authorityUse, replacements, outputs, missing,
  // (task mall-round3-20261031 / recovery01-20261101, lane SHOPS, R4) accepted models outside the Track3 batches (EXTRA): own task, ledger, credits
  extraOutputs: extraOut};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }

// ---------- allowlist (only this task's paths) ----------
const MY_PATHS = new Set([PROV_REL, ...[...SPECS.values()].map(v => outRelOf(v.spec.assetId)), ...Object.values(EDITS).flatMap(e => Object.keys(e.parts ?? {}).map(partRelOf)),
  ...(prevProv?.outputs ?? []).flatMap(o => [o.output.url, ...(o.parts ?? []).map(q => q.output.url)]),
  ...Object.values(EXTRA).map(x => outRelOf(x.id)), ...(prevProv?.extraOutputs ?? []).map(o => o.output.url)]);
const newFiles = DRY ? [...outputs, ...extraOut].flatMap(o => [{path: o.output.url, buf: null, bytes: o.output.bytes, sha256: o.output.sha256}])
  : [...outputs.flatMap(o => [o.output.url, ...(o.parts ?? []).map(q => q.output.url)]), ...extraOut.map(o => o.output.url)].map(u => ({path: u, buf: fs.readFileSync(path.join(PUB, u))}));
if (outputs.length) newFiles.push({path: PROV_REL, buf: provBuf});
const added = newFiles.map(f => ({path: f.path, bytes: f.buf ? f.buf.length : f.bytes, sha256: f.buf ? sha(f.buf) : f.sha256}));
const kept = allow.files.filter(f => !MY_PATHS.has(f.path));
const dropped = allow.files.filter(f => MY_PATHS.has(f.path) && !added.some(x => x.path === f.path)).map(f => f.path);
allow.files = [...kept, ...added].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

// ---------- CREDITS section ----------
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const credSection = outputs.length ? [CREDITS_BEGIN, "## The Eaton's Center (Track3): mall fixtures, furniture and loose stock", '',
  `Generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's finite Track3 authorization; runtime derivatives built by \`tools/asset-pipeline/props/build-mall-track3.mjs\` (provenance: \`${PROV_REL}\`). Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters are kept outside Git.`, '',
  ...outputs.map(o => `- \`${o.output.url}\` — ${o.id} (${o.code}; Meshy tasks ${o.tasks.preview} / ${o.tasks.refine})`),
  ...extraOut.map(o => `- \`${o.output.url}\` — ${o.id} (${o.code}; Meshy tasks ${o.tasks.preview} / ${o.tasks.refine}; round-3 addition generated by the primary under the user's round-3 approval, task ${o.task}; provider terms apply)`),
  CREDITS_END].join('\n') : null;
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credSection ? (credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`)
  : credRe.test(credSrc) ? credSrc.replace(credRe, '').replace(/\n{3,}$/, '\n') : credSrc;

// ---------- registry blocks ----------
const q = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "\\'")}'`);
const arr = v => `[${v.join(', ')}]`;
const specList = [...SPECS.values()].map(v => v.spec).sort((a, b) => (a.code < b.code ? -1 : 1));
// (lane SHOPS, R4) EXTRA assets sort in by code with the Track3 ones
const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const assetLines = [...specList.map(s => {
  const o = outputs.find(x => x.id === s.assetId);
  return [s.code, `  '${s.assetId}': {url: ${o && !DRY ? q(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, tris: ${o ? o.output.triangles : 0}, code: '${s.code}', key: '${libraryKey(s.assetId)}'},`];
}), ...extraOut.map(o => [o.code, `  '${o.id}': {url: ${!DRY ? q(o.output.url) : 'null'}, bytes: ${o.output.bytes}, tris: ${o.output.triangles}, code: '${o.code}', key: '${o.key}'},`])].sort(byCode).map(x => x[1]);
const partLines = outputs.flatMap(o => (o.parts ?? []).map(p => `  '${p.id}': {url: ${q(p.output.url)}, bytes: ${p.output.bytes}, tris: ${p.output.triangles}, from: '${o.id}'},`));
const block1 = ['// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers',
  'export const MALL_ASSETS: Readonly<Record<string, MallAssetEntry>> = {', ...assetLines, '};', '',
  'export const MALL_PART_ASSETS: Readonly<Record<string, MallPartEntry>> = {', ...partLines, '};', '// END GENERATED'].join('\n');
const block2 = ['// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers',
  'export const MALL_DIMS: Readonly<Record<string, readonly [number, number, number]>> = {',
  ...[...outputs, ...extraOut].filter(() => !DRY).map(o => [o.code, `  '${o.id}': ${arr(o.output.dims)},`]).sort(byCode).map(x => x[1]), '};', '',
  'export const MALL_ASSET_SPECS: Readonly<Record<string, MallAssetSpec>> = {',
  ...[...specList.map(s => [s.code, `  '${s.assetId}': {code: '${s.code}', role: ${q(s.role)}, programs: [${(s.programs ?? []).map(q).join(', ')}], sizeM: ${EDITS[s.assetId]?.sizeM ?? s.targetSize.sizeM}, sizeAxis: '${EDITS[s.assetId]?.sizeAxis ?? s.targetSize.sizeAxis}', target: ${arr([s.targetSize.w, s.targetSize.h, s.targetSize.d])}, placement: ${q(s.placement)}, shopsKind: ${q(s.shopsKind?.kind)}},`]),
    ...extraOut.map(o => [o.code, `  '${o.id}': {code: '${o.code}', role: ${q(o.role)}, programs: [${o.programs.map(q).join(', ')}], sizeM: ${o.sizeM}, sizeAxis: '${o.sizeAxis}', target: ${arr(o.target)}, placement: ${q(o.placement)}, shopsKind: ${q(o.shopsKind)}},`])].sort(byCode).map(x => x[1]),
  '};', '// END GENERATED'].join('\n');
const re = /\/\/ BEGIN GENERATED[^\n]*\n[\s\S]*?\/\/ END GENERATED/;
const regNext = [[REGISTRY, block1], [DIMS_TS, block2]].map(([f, blk]) => {
  const src = fs.readFileSync(f, 'utf8');
  if (!re.test(src)) throw new Error(`GENERATED markers missing in ${f}`);
  return [f, src, src.replace(re, blk)];
});

// ---------- delivery note ----------
const delivered = {task: TASK, generatedBy: 'tools/asset-pipeline/props/build-mall-track3.mjs', policy: POLICY, credits: creditSummary, authorityUse, replacements, assets: {}};
for (const s of specList) {
  const o = outputs.find(x => x.id === s.assetId), mi = missing.find(x => x.id === s.assetId);
  delivered.assets[s.assetId] = {code: s.code, key: libraryKey(s.assetId), shopsKind: s.shopsKind?.kind ?? null, status: o ? 'ready' : /failed/.test(mi?.reason ?? '') ? 'failed' : 'missing',
    url: o ? o.output.url : null, dims: o ? o.output.dims : null, sizeM: o?.sizeM ?? s.targetSize.sizeM, sizeAxis: o?.sizeAxis ?? s.targetSize.sizeAxis, tris: o?.output.triangles ?? 0, bytes: o?.output.bytes ?? 0,
    interaction: s.interaction, placement: s.placement, frontIs: s.frontIs, note: o ? `front -Z, grounded, centred${o.note ? `; ${o.note}` : ''}${o.output.overBudget ? '; OVER byte budget' : ''}` : mi.reason};
}

const totalBytes = outputs.reduce((s2, o) => s2 + o.output.bytes + (o.parts ?? []).reduce((t, p) => t + p.output.bytes, 0), 0);
const gpu = outputs.reduce((s2, o) => s2 + o.output.gpuTextureBytes, 0);
if (DRY) {
  console.log(JSON.stringify({dryRun: true, policy: POLICY, freezes: freezes.length, frozenAssets: SPECS.size, accepted: outputs.length, missing: missing.length,
    wouldWrite: {models: outputs.length, provenance: outputs.length ? PROV_REL : null, allowlist: {own: added.length, dropped}, registry: path.relative(root, REGISTRY), dims: path.relative(root, DIMS_TS),
      credits: credNext !== credSrc, registryChanged: regNext.some(([, a, b]) => a !== b)},
    runtimeBytes: totalBytes, gpuTextureBytes: gpu, credits: creditSummary, authorityUse}, null, 1));
  process.exit(0);
}
if (outputs.length) fs.writeFileSync(PROV, provBuf);
else if (fs.existsSync(PROV) && prevProv?.task === TASK) fs.unlinkSync(PROV);
if (credNext !== credSrc) fs.writeFileSync(CREDITS, credNext);
{ const ce = allow.files.find(f => f.path === CREDITS_REL); const cb = fs.readFileSync(CREDITS); if (ce && (ce.bytes !== cb.length || ce.sha256 !== sha(cb))) { ce.bytes = cb.length; ce.sha256 = sha(cb); } }
if (ALLOW_OUT) fs.writeFileSync(ALLOW_OUT, JSON.stringify({note: 'entries build-mall-track3.mjs owns (tools/release/public-inputs.json files[]); stale ones dropped', owned: [...MY_PATHS].sort(), dropped,
  files: allow.files.filter(f => MY_PATHS.has(f.path) || f.path === CREDITS_REL)}, null, 2) + '\n');
else fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
for (const [f, a, b] of regNext) if (a !== b) fs.writeFileSync(f, b);
if (!NO_DELIVERED) { const tmp = `${DELIVERED}.tmp-${process.pid}`; const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(delivered, null, 1) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, DELIVERED); }
console.log(`mall models ready ${outputs.length}/${SPECS.size} frozen (${(totalBytes / 1e6).toFixed(2)} MB runtime, ~${(gpu / 1e6).toFixed(0)} MB GPU textures, ${POLICY}); credits ${JSON.stringify(creditSummary)}; allowlist ${added.length} own entries${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
