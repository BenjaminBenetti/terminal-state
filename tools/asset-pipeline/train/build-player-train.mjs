// Task studio-beta-player-train-shell-20261101-202805-01 (Studio Beta, lane ASSETS): runtime derivatives of the level-one PLAYER
// TRAIN (the player's home car): the accepted Meshy T2.5 shell / driving desk / door leaf and the four accepted Codex interior
// textures, plus the MEASURED train-local spec (game/src/world/playerTrainSpec.ts reads PLAYER_TRAIN_MEASURED).
//
// Reads (never modifies) the task records kept OUTSIDE Git in reference/tasks/player-train-shell-20261101-202805/:
//   meshy/LEDGER.jsonl     fsynced reserve / intent / ack / status / qc / accept / close lines (budget proof; accepted task ids)
//   meshy/MANIFEST.json    the frozen prompts (preview + refine texture prompts)
//   meshy/RAW-SHA256.txt   the accepted raw hashes; meshy/raw/<part>-refine-<task>.glb  immutable native GLBs (2K PBR)
//   codex/<id>/<id>-original.png + receipt.json + prompt.txt, codex/SOURCES-SHA256.txt  (owned Codex CLI native image_gen)
// and writes deterministically:
//   game/public/assets/models/player-train-{shell,door-leaf,console}.glb   shared paths (every station level parks the car)
//   game/public/assets/textures/train/train-int-{wall,floor,ceiling,bulkhead}.jpg   1024 px sRGB JPEG (resize + format only)
//   game/public/assets/derivatives/player-train-20261101.json              provenance (no URLs / tokens / local paths)
//   game/src/assets/playerTrain.generated.ts                              urls / bytes / tris / dims + PLAYER_TRAIN_MEASURED
//   game/public/assets/CREDITS.md                                         the marked player-train section
//   tools/release/public-inputs.json                                      ONLY this script's paths (+ CREDITS.md) added / updated
//
// TRAIN-LOCAL FRAME (the shared contract, LANES.md): origin = car centre on the track centre line at RAIL-TOP height, +X = the
// FRONT (cab end), +Y up, -Z = the PLATFORM side. The raw shell already has its length along X; its raw +X end becomes the front
// (no turn, no mirror): only that end leaves room for a full-width ~2.2 m cab between the nearest door pair and the rounded nose
// corners (the raw -X end, which carries the route box, has ~1.1 m), and the raw -Z side (the small stripe wedge) stays the platform
// side while the large grey X smear over one window stays on the far (+Z) side. Texture artifacts are kept as generated.
//
// SHELL = mesh processing of the ONE accepted refine, no regeneration (all constants below were measured on the raw GLB with
// orthographic depth maps / cross-sections; the script re-checks them):
//  1. Components (position-welded): the BODY (largest component), the two BOGIES (wheels / frames / axles inside each bogie zone,
//     below the body underside, |z| <= 0.076 raw) and the UNDERFRAME (everything else below the underside: equipment boxes, beams,
//     couplers). Roof vents / end fittings ride with the body.
//  2. Body: x / z scale S (car width ~2.99 m), y scale SY ABOVE the measured underside plane (taller, so the doors clear 2.0 m) and S
//     below it (skirts / end aprons), placed so the door sill = the interior floor sits FLOOR_Y above the rail top. Underframe: x / z
//     scale S, y scale S, hung from the scaled underside. Bogies: UNIFORM in x / y (round wheels) by SB = the underside height over
//     the raw wheel-to-underside drop (keeps the raw bogie-to-body relation; ~0.71 m wheels, ~2.0 m wheelbase), each about its own
//     centre placed at S x its raw centre, z by SBZ so the wheel treads sit on the running rails (+-0.72 m); wheel bottoms = y 0.
//  3. Door openings: on both sides the three measured door-panel recess rectangles are clipped out of the skin EXACTLY (triangles
//     split on the rectangle edges, attributes interpolated; the part inside with |z| > 1.1 m on that side is removed), so the
//     game's sliding leaves can open onto a real doorway. Jambs / reveals (interior wall -> leaf plane) are left to the runtime
//     (lane TRAIN, procedural), using PLAYER_TRAIN_MEASURED.doorLeaf.outerZ and interior.halfWidth.
//  4. Checks: no shell triangle intersects the walkable interior box or any door leaf's sliding pocket; wheels on the rails;
//     grounded on the rail plane; fit constraints of LANES.md.
// The native 2K PBR material is kept channel for channel (base colour 2048, normal 1024, metallic-roughness 512, JPEG).
//
// DOOR LEAF: the raw leaf's -Z face carries an upside-down human figure baked into the glass (provider artifact; not painted over).
// The leaf is rebuilt from its CLEAN +Z half: clipped at the slab mid-plane, the kept half mirrored onto the other side (same UVs,
// so the figure's region of the atlas is simply never sampled), then fitted to ONE leaf of a centre-opening pair for the widest
// doorway (non-uniform: a flat panel). Frame: grounded, centred, closing edge (the T-handle) at +X, faces +-Z. Twelve leaves per car,
// so the clean half is decimated by POSITION to ~520 triangles (meshoptimizer; the Meshy atlas splits about half of all vertices on
// UV seams, which stalls any UV-preserving decimation at ~1,000+ per half), given a planar front UV, and the leaf's OWN accepted maps
// (base colour, metallic-roughness, tangent-space normal re-expressed for the new frame) are re-baked onto it by an orthographic +Z
// projection of the clean half (UV baking of the same source: no painting, nothing of the -Z face sampled). ~1,040 triangles per leaf.
// CONSOLE: turned so the operator side (native +Z) faces -X (the driver stands behind it looking toward the front, +X), UNIFORM
// scale so its control ledge stands at desk height (~0.72 m, rule 5), grounded, centred.
//
//   node tools/asset-pipeline/train/build-player-train.mjs [--dry-run | --check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {resolveCoverageFull, dropDegenerate, creaseNormals, censusOf, faceNormal, rasterFace, darkBox, ringMin, cutRect} from './lib/mesh-repair.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-player-train-shell-20261101-202805-01';
const TASK_DIR = 'reference/tasks/player-train-shell-20261101-202805';
const MESHY = path.join(root, TASK_DIR, 'meshy');
const CODEX = path.join(root, TASK_DIR, 'codex');
const PUB = path.join(root, 'game/public');
const PROV_REL = 'assets/derivatives/player-train-20261101.json';
const GEN = path.join(root, 'game/src/assets/playerTrain.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS_BEGIN = '<!-- BEGIN player-train-20261101 (build-player-train.mjs) -->';
const CREDITS_END = '<!-- END player-train-20261101 -->';
const MODEL = {shell: 'assets/models/player-train-shell.glb', leaf: 'assets/models/player-train-door-leaf.glb', console: 'assets/models/player-train-console.glb'};
const TEX_DIR = 'assets/textures/train';
const CODEX_IDS = [['train-int-wall', 'interior side wall, one window bay (tiles along the car)'], ['train-int-floor', 'ribbed rubber floor (tiles in 2D)'],
  ['train-int-ceiling', 'vented ceiling panels (tiles in 2D)'], ['train-int-bulkhead', 'end bulkhead with a central closed door (one panel)']];
const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-player-train: ${m}`); process.exit(1); };
const r4 = v => +v.toFixed(4), r3 = v => +v.toFixed(3);

// ---------- measured raw constants (raw shell units; see the header) ----------
const RAW = {
  underside: -0.0505, // the body's flat underside plane (cross-sections at x = -0.2 / -0.12 / 0.1 / 0.15: -0.0509 .. -0.0491)
  sill: -0.0488, // the door-panel recess bottom = the interior floor level (all 6 doors -0.0485 .. -0.0495)
  doorTop: 0.0565, // the door-panel recess top (measured 0.0555 .. 0.0580; one common cut height)
  // door-panel recess x ranges, both sides averaged (each side within 0.001): front (raw +X) / middle / rear
  doors: [[0.2125, 0.2760], [-0.0233, 0.0447], [-0.3538, -0.2863]],
  bogieHalfLen: 0.09, bogieMaxZ: 0.076,
};
const S = 17.0; // body x / z: raw body width 0.1759 -> ~2.99 m
const SY = 19.0; // body y above the underside (door 0.1053 raw -> 2.0 m clear)
const FLOOR_Y = 0.98; // interior floor (door sill) above the rail top: 0.125 m above the platform (platform = +0.855)
const RAIL_HALF_GAUGE = 0.72;
const CUT_MIN_Z = 1.1; // cooked |z| beyond which a piece inside a door rectangle is skin (the openings never touch roof / floor)
// layout decisions on the measured car (m, train-local)
const INTERIOR_HALF_WIDTH = 1.30; // walkable half width inside the skin (skin >= 1.39 at every height of the interior band)
const INTERIOR_HALF_LENGTH = 7.25; // flat bulkheads before the nose / tail corners round in (|x| > 0.43 raw)
const CEILING_ABOVE_FLOOR = 2.27;
const CAB_DEPTH = 2.2;
const CAB_DOORWAY = {halfWidth: 0.45, height: 2.0};
const LEAF = {overlap: 0.03, thickness: 0.045, top: 0.03}; // leaf = half the widest doorway + overlap at the jamb; into the header
const CONSOLE = {scale: 2.05, frontGap: 0.04};
// door leaf: 12 per car, so a light flat panel: the clean half is decimated by POSITION (meshoptimizer; the Meshy atlas splits about
// half of all vertices on UV seams, which blocks any UV-preserving decimation near the target), re-UV'd by a planar front projection
// and the accepted Meshy maps re-baked onto it (UV baking of the same source; no painting); ~1,000 triangles per leaf
const LEAF_LOD = {targetHalfTriangles: 520, error: 0.004, creaseDeg: 40, bake: {w: 512, h: 1024, supersample: 2}};
const LAMP_OFFSET = 0.05; // light mounts sit this far in front of the lamp lens
// Task train-shell-followup-20261101-221246 (user: "messed up geometry / triangles", "you should be able to see through the windows"):
// REPAIR = single coverage of near-coincident parallel faces (Meshy folds: inward flaps lying on the skin; duplicate layers) + crease
// normals from the final faces; WINDOWS = exact through-cuts of the cab / rear-compartment side windows and both end faces' windows
// (found as the dark glass inside these search boxes on the repaired surface; rect = the glass box inset by the gasket), and the door
// leaf's window (inside its frame rim, the closing-edge stile with the T-handle kept). Glass panes / lining sleeves: lane TRAIN.
const REPAIR = {cos: 0.97, gap: 0.003, creaseDeg: 40};
// side windows stay POCKET_CLEAR away from the open door leaves' wall pockets (an open leaf would show through the glass: lane TRAIN)
// and are skipped when less than MIN_WIDTH remains (the rear-compartment side windows: the rear door's open leaf covers them)
const WINDOW = {inset: 0.03, dark: 55, px: 0.01, y: [1.75, 3.1], endZMax: 1.28, endCutMin: 7.26, ring: 0.02, pocketClear: 0.04, slide: 0.01, minWidth: 0.4};
const SIDE_WINDOW_SEARCH = [{zone: 'cab', x: [5.15, 6.5]}, {zone: 'cab', x: [6.5, 7.08]}, {zone: 'rear', x: [-6.98, -6.3]}];
const END_WINDOW_SEARCH = [{z: [-1.5, -0.55]}, {z: [-0.55, 0.55]}, {z: [0.55, 1.5]}];
const LEAF_WINDOW = {rimMargin: 0.02, topMargin: 0.04, bottom: 0.06, stileGap: 0.015};
const TEX = {shell: {base: 2048, normal: 1024, mr: 512, quality: 82}, leaf: {base: [512, 1024], normal: [256, 512], mr: [128, 256], quality: 85, baked: 'planar front projection'}, console: {base: 1024, normal: 512, mr: 256, quality: 85}, codex: {size: 1024, quality: 85}};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ---------- records: ledger / manifest / raw hashes / Codex receipts ----------
for (const f of ['LEDGER.jsonl', 'MANIFEST.json', 'RAW-SHA256.txt']) if (!fs.existsSync(path.join(MESHY, f))) fail(`missing ${TASK_DIR}/meshy/${f} (raw masters live outside Git)`);
const ledger = fs.readFileSync(path.join(MESHY, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(MESHY, 'MANIFEST.json'), 'utf8'));
const rawSums = new Map(fs.readFileSync(path.join(MESHY, 'RAW-SHA256.txt'), 'utf8').split('\n').filter(Boolean).map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const last = ledger[ledger.length - 1];
const close = ledger.find(e => e.event === 'close');
if (!close) fail('no close record: generation must be closed before a derivative ships');
const open = ledger.find(e => e.event === 'open');
if (last.billed + last.reserved > open.ceilings.billedPlusReserved || last.attempts > open.ceilings.attempts || last.attemptedPOSTs > open.ceilings.attemptedPOSTs || last.accepted !== 3 || last.reserved !== 0)
  fail(`ledger outside the authority: ${JSON.stringify(last)}`);
const PARTS = {shell: 'train-shell', leaf: 'train-door-leaf', console: 'train-cab-console'};
const accepted = {};
for (const [k, part] of Object.entries(PARTS)) {
  const acc = ledger.filter(e => e.event === 'accept' && e.part === part);
  if (acc.length !== 1) fail(`${part}: expected exactly one accept, found ${acc.length}`);
  const a = acc[0];
  const file = [...rawSums.keys()].find(f => f.endsWith(`-refine-${a.task_id.slice(0, 13)}.glb`));
  if (!file) fail(`${part}: no raw refine for ${a.task_id} in RAW-SHA256.txt`);
  const buf = fs.readFileSync(path.join(MESHY, 'raw', file));
  if (sha(buf) !== rawSums.get(file)) fail(`${part}: raw sha mismatch ${file}`);
  const previewFile = [...rawSums.keys()].find(f => f.endsWith(`-preview-${a.preview_task_id.slice(0, 13)}.glb`));
  const billed = ledger.filter(e => e.event === 'status' && e.part === part && [a.task_id, a.preview_task_id].includes(e.task_id)).reduce((n, e) => n + e.consumed_credits, 0);
  accepted[k] = {part, task: a.task_id, preview: a.preview_task_id, file, buf, sha256: rawSums.get(file), previewFile, previewSha256: previewFile ? rawSums.get(previewFile) : null, billed};
}
const codexSums = new Map(fs.readFileSync(path.join(CODEX, 'SOURCES-SHA256.txt'), 'utf8').split('\n').filter(Boolean).map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const codex = [];
for (const [id, subject] of CODEX_IDS) {
  const dir = path.join(CODEX, id), file = `${id}/${id}-original.png`;
  const buf = fs.readFileSync(path.join(CODEX, file)), r = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8')), prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
  const h = sha(buf);
  if (codexSums.get(file) !== h) fail(`${id}: sha256 ${h} is not the accepted SOURCES-SHA256.txt hash`);
  if (r.id !== id || r.sha256 !== h || r.bytes !== buf.length) fail(`${id}: receipt.json does not describe this file`);
  if (String(r.codexExit) !== '0' || r.nativeSha256Matches !== true || !r.codexThreadId) fail(`${id}: receipt is not a clean Codex result`);
  if (r.prompt !== prompt) fail(`${id}: receipt prompt differs from prompt.txt`);
  if (fs.existsSync(path.join(dir, 'codex-blocker.txt'))) fail(`${id}: a Codex blocker is recorded`);
  codex.push({id, subject, file, buf, r, prompt});
}

// ---------- geometry helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** The single primitive of a flattened raw doc as plain arrays. */
async function readRaw(buf) {
  const doc = await io.readBinary(new Uint8Array(buf));
  await doc.transform(flatten());
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  if (prims.length !== 1) fail(`expected one primitive, found ${prims.length}`);
  const p = prims[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`raw primitive lacks ${s}`);
  return {doc, prim: p, pos: Array.from(p.getAttribute('POSITION').getArray()), nrm: Array.from(p.getAttribute('NORMAL').getArray()),
    uv: Array.from(p.getAttribute('TEXCOORD_0').getArray()), idx: Array.from(p.getIndices().getArray())};
}

/** Vertex record [px, py, pz, nx, ny, nz, u, v]. */
const vert = (g, i) => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2], g.uv[i * 2], g.uv[i * 2 + 1]];
const lerpV = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
/** Sutherland-Hodgman: the part of convex polygon `poly` with sign * (v[axis] - value) >= 0. */
function clip(poly, axis, value, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = sign * (a[axis] - value), db = sign * (b[axis] - value);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); const v = lerpV(a, b, t); v[axis] = value; out.push(v); }
  }
  return out.length >= 3 ? out : [];
}
const fanTris = poly => { const t = []; for (let i = 1; i + 1 < poly.length; i++) t.push([poly[0], poly[i], poly[i + 1]]); return t; };
const triArea = t => Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0]))) / 2;

/** Writes triangles (vertex records) back into `prim` (welded by exact value), normals renormalized. */
function writeTris(doc, prim, tris) {
  const map = new Map(), P = [], N = [], U = [], I = [];
  const f32 = new Float32Array(8);
  for (const t of tris) for (const v0 of t) {
    const n = norm([v0[3], v0[4], v0[5]]);
    f32.set([v0[0], v0[1], v0[2], n[0], n[1], n[2], v0[6], v0[7]]);
    const key = Array.from(f32).join(',');
    let i = map.get(key);
    if (i === undefined) { i = P.length / 3; map.set(key, i); P.push(f32[0], f32[1], f32[2]); N.push(f32[3], f32[4], f32[5]); U.push(f32[6], f32[7]); }
    I.push(i);
  }
  const buffer = doc.getRoot().listBuffers()[0];
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buffer));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(U)).setBuffer(buffer));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I)).setBuffer(buffer));
}

/** Triangle / AABB overlap (separating axes; Akenine-Moller). */
function triBox(c, h, a, b, d) {
  const v0 = sub(a, c), v1 = sub(b, c), v2 = sub(d, c);
  for (let k = 0; k < 3; k++) if (Math.min(v0[k], v1[k], v2[k]) > h[k] || Math.max(v0[k], v1[k], v2[k]) < -h[k]) return false;
  const sep = ax => { const p0 = dot(v0, ax), p1 = dot(v1, ax), p2 = dot(v2, ax); const r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]); return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r; };
  const e = [sub(v1, v0), sub(v2, v1), sub(v0, v2)];
  for (const ed of e) for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const ax = cross(u, ed); if ((ax[0] || ax[1] || ax[2]) && sep(ax)) return false; }
  return !sep(cross(e[0], e[1]));
}
const boxHits = (tris, box) => {
  const c = [0, 1, 2].map(k => (box.min[k] + box.max[k]) / 2), h = [0, 1, 2].map(k => (box.max[k] - box.min[k]) / 2);
  const hits = tris.filter(t => triBox(c, h, t[0], t[1], t[2]));
  if (hits.length && process.env.TRAIN_DEBUG) console.error('hits in', JSON.stringify(box), hits.slice(0, 12).map(t => [0, 1, 2].map(k => `${Math.min(...t.map(p => p[k])).toFixed(3)}..${Math.max(...t.map(p => p[k])).toFixed(3)}`).join(' ')));
  return hits.length;
};

/** Grounds (min y = 0) and centres (x / z) triangles, scaling by scaleOf(size) per axis (normals by the inverse scale). */
function fitTris(tris, scaleOf) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const sc = scaleOf([0, 1, 2].map(k => hi[k] - lo[k])), c = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  return {scale: sc, tris: tris.map(t => t.map(v => [(v[0] - c[0]) * sc[0], (v[1] - c[1]) * sc[1], (v[2] - c[2]) * sc[2], ...norm([v[3] / sc[0], v[4] / sc[1], v[5] / sc[2]]), v[6], v[7]]))};
}

/** Position-only meshoptimizer decimation of a triangle soup (welded at 0.1 um raw). Open borders only collapse along themselves,
 *  so a planar clip border stays on its plane. Returns position triangles. */
async function decimatePositions(tris, targetTriangles, error) {
  await MeshoptSimplifier.ready;
  const key = v => `${Math.round(v[0] * 1e7)},${Math.round(v[1] * 1e7)},${Math.round(v[2] * 1e7)}`;
  const map = new Map(), pos = [], idx = [];
  for (const t of tris) {
    const ids = t.map(v => { const k = key(v); let i = map.get(k); if (i === undefined) { i = pos.length; map.set(k, i); pos.push([v[0], v[1], v[2]]); } return i; });
    if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) idx.push(...ids);
  }
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx), new Float32Array(pos.flat()), 3, targetTriangles * 3, error, []);
  const res = [];
  for (let i = 0; i < out.length; i += 3) res.push([pos[out[i]], pos[out[i + 1]], pos[out[i + 2]]]);
  return res;
}

/** Crease-angle vertex normals for position triangles -> vertex records with a planar UV (u along +x, v down along -y). */
function shadePlanar(tris, creaseDeg, box) {
  const fn = tris.map(t => cross(sub(t[1], t[0]), sub(t[2], t[0]))); // area-weighted face normals
  const unit = fn.map(norm), byPos = new Map(), cosC = Math.cos(creaseDeg * Math.PI / 180);
  tris.forEach((t, f) => t.forEach(p => { const k = p.join(','); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(f); }));
  return tris.map((t, f) => t.map(p => {
    const n = [0, 0, 0];
    for (const g of byPos.get(p.join(','))) if (dot(unit[f], unit[g]) >= cosC) for (let k = 0; k < 3; k++) n[k] += fn[g][k];
    const nn = norm(n);
    return [p[0], p[1], p[2], nn[0], nn[1], nn[2], (p[0] - box.x0) / (box.x1 - box.x0), (box.y1 - p[1]) / (box.y1 - box.y0)];
  }));
}

/** three.js derivative tangent frame of a triangle (T = dP/du, B = dP/dv, orthonormalized against N). */
function uvFrame(t, N) {
  const e1 = sub(t[1], t[0]), e2 = sub(t[2], t[0]);
  const du1 = t[1][6] - t[0][6], dv1 = t[1][7] - t[0][7], du2 = t[2][6] - t[0][6], dv2 = t[2][7] - t[0][7];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-14) return null;
  const T = [0, 1, 2].map(k => (e1[k] * dv2 - e2[k] * dv1) / det), B = [0, 1, 2].map(k => (e2[k] * du1 - e1[k] * du2) / det);
  const ortho = v => norm(sub(v, N.map(x => x * dot(v, N))));
  return {T: ortho(T), B: ortho(B)};
}

/** Orthographic +Z projection bake of the source triangles' maps (base colour, metallic-roughness, tangent-space normal re-expressed
 *  for the planar target UV; three.js / GLTFLoader derivative-tangent convention: n = T * x - B * y + N * z). */
async function bakePlanar(src, maps, box, {w, h, supersample: ss}) {
  const W = w * ss, H = h * ss;
  const cell = Math.max((box.x1 - box.x0) / 96, 1e-4), gw = Math.ceil((box.x1 - box.x0) / cell) + 1, gh = Math.ceil((box.y1 - box.y0) / cell) + 1;
  const grid = Array.from({length: gw * gh}, () => []);
  const pre = src.map((t, f) => {
    const N = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
    const d = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
    const xs = t.map(v => v[0]), ys = t.map(v => v[1]);
    for (let gy = Math.floor((Math.min(...ys) - box.y0) / cell); gy <= Math.floor((Math.max(...ys) - box.y0) / cell); gy++)
      for (let gx = Math.floor((Math.min(...xs) - box.x0) / cell); gx <= Math.floor((Math.max(...xs) - box.x0) / cell); gx++)
        if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx].push(f);
    return {t, d, N, frame: uvFrame(t, N)};
  });
  const sample = (m, u, v) => {
    const x = Math.min(m.w - 1, Math.max(0, (u - Math.floor(u)) * m.w - 0.5)), y = Math.min(m.h - 1, Math.max(0, (v - Math.floor(v)) * m.h - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(m.w - 1, x0 + 1), y1 = Math.min(m.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
    return [0, 1, 2].map(c => (m.data[(y0 * m.w + x0) * 3 + c] * (1 - fx) + m.data[(y0 * m.w + x1) * 3 + c] * fx) * (1 - fy)
      + (m.data[(y1 * m.w + x0) * 3 + c] * (1 - fx) + m.data[(y1 * m.w + x1) * 3 + c] * fx) * fy);
  };
  const out = {base: new Float32Array(W * H * 3), mr: new Float32Array(W * H * 3), normal: new Float32Array(W * H * 3)}, hit = new Uint8Array(W * H);
  let misses = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = box.x0 + (i + 0.5) / W * (box.x1 - box.x0), y = box.y1 - (j + 0.5) / H * (box.y1 - box.y0);
    const gx = Math.min(gw - 1, Math.floor((x - box.x0) / cell)), gy = Math.min(gh - 1, Math.floor((y - box.y0) / cell));
    let best = null, bz = -Infinity, bw = null;
    for (const f of grid[gy * gw + gx]) {
      const {t, d} = pre[f];
      if (Math.abs(d) < 1e-16) continue;
      const a = ((t[1][0] - x) * (t[2][1] - y) - (t[2][0] - x) * (t[1][1] - y)) / d, b = ((t[2][0] - x) * (t[0][1] - y) - (t[0][0] - x) * (t[2][1] - y)) / d, c = 1 - a - b;
      if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue;
      const z = a * t[0][2] + b * t[1][2] + c * t[2][2];
      if (z > bz) { bz = z; best = pre[f]; bw = [a, b, c]; }
    }
    const o = (j * W + i) * 3;
    if (!best) { misses++; continue; }
    hit[j * W + i] = 1;
    const {t, N, frame} = best;
    const u = bw[0] * t[0][6] + bw[1] * t[1][6] + bw[2] * t[2][6], v = bw[0] * t[0][7] + bw[1] * t[1][7] + bw[2] * t[2][7];
    const bc = sample(maps.base, u, v), mr = sample(maps.mr, u, v);
    let n = N;
    if (frame) { const q = sample(maps.normal, u, v).map(c => c / 127.5 - 1); n = norm([0, 1, 2].map(k => frame.T[k] * q[0] - frame.B[k] * q[1] + N[k] * q[2])); }
    // target frame (planar UV): T' = +x, B' = -y projected on the tangent plane of N
    const Tt = norm(sub([1, 0, 0], N.map(c => c * N[0]))), Bt = norm(sub([0, -1, 0], N.map(c => c * -N[1])));
    const enc = [dot(n, Tt), -dot(n, Bt), dot(n, N)];
    for (let c = 0; c < 3; c++) { out.base[o + c] = bc[c]; out.mr[o + c] = mr[c]; out.normal[o + c] = enc[c]; }
  }
  // fill the (rare) misses from hit neighbours, then box-downsample the supersampled maps
  for (let pass = 0; pass < 8 && misses; pass++) {
    const next = Uint8Array.from(hit);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (hit[j * W + i]) continue;
      const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < H && hit[b * W + a]);
      if (!nb.length) continue;
      for (const k of ['base', 'mr', 'normal']) for (let c = 0; c < 3; c++) out[k][(j * W + i) * 3 + c] = nb.reduce((sum, [a, b]) => sum + out[k][(b * W + a) * 3 + c], 0) / nb.length;
      next[j * W + i] = 1; misses--;
    }
    hit.set(next);
  }
  const down = (img, isNormal) => {
    const r = Buffer.alloc(w * h * 3);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const acc = [0, 0, 0];
      for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) for (let c = 0; c < 3; c++) acc[c] += img[((j * ss + b) * W + i * ss + a) * 3 + c];
      let v = acc.map(x => x / (ss * ss));
      if (isNormal) v = norm(v).map(x => (x + 1) * 127.5);
      for (let c = 0; c < 3; c++) r[(j * w + i) * 3 + c] = Math.max(0, Math.min(255, Math.round(v[c])));
    }
    return r;
  };
  return {base: down(out.base, false), mr: down(out.mr, false), normal: down(out.normal, true), misses};
}

async function finishDoc(doc, name, tex) {
  const r = doc.getRoot();
  r.listMeshes().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${name}-${i}` : name));
  r.listMaterials().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  if (tex.baked) await doc.transform(dedup(), prune());
  else await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tex.base, tex.base], quality: tex.quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tex.mr, tex.mr], quality: tex.quality, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tex.normal, tex.normal], quality: tex.quality, slots: /^normal/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/train/build-player-train.mjs (glTF-Transform)';
  const glb = Buffer.from(await io.writeBinary(doc));
  // measure the written file
  const d2 = await io.readBinary(new Uint8Array(glb));
  const R = d2.getRoot();
  const bb = getBounds(R.getDefaultScene() ?? R.listScenes()[0]);
  const tris = R.listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((u, p) => u + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const mats = R.listMaterials();
  const textures = R.listTextures().map(t => ({
    slot: mats.flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]).find(([, x]) => x === t)?.[0] ?? 'unused',
    size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  return {glb, bounds: {min: bb.min.map(r4), max: bb.max.map(r4)}, dims: [0, 1, 2].map(k => r4(bb.max[k] - bb.min[k])), tris, meshes: R.listMeshes().length,
    materials: mats.length, textures, gpuBytesWithMips: textures.reduce((g, t) => g + (t.size ? Math.round(t.size[0] * t.size[1] * 4 * 4 / 3) : 0), 0),
    doubleSided: mats.every(m => m.getDoubleSided())};
}

// ======================================================================================================================
// SHELL
// ======================================================================================================================
const shellRaw = await readRaw(accepted.shell.buf);
const nV = shellRaw.pos.length / 3;
// position-welded components
const canon = new Int32Array(nV), byPos = new Map();
for (let i = 0; i < nV; i++) { const k = `${Math.round(shellRaw.pos[i * 3] * 1e5)},${Math.round(shellRaw.pos[i * 3 + 1] * 1e5)},${Math.round(shellRaw.pos[i * 3 + 2] * 1e5)}`; if (!byPos.has(k)) byPos.set(k, i); canon[i] = byPos.get(k); }
const parent = Int32Array.from({length: nV}, (_, i) => i);
const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (let t = 0; t < shellRaw.idx.length; t += 3) { const a = find(canon[shellRaw.idx[t]]); parent[find(canon[shellRaw.idx[t + 1]])] = a; parent[find(canon[shellRaw.idx[t + 2]])] = a; }
const comps = new Map();
for (let i = 0; i < nV; i++) {
  const c0 = find(canon[i]);
  let c = comps.get(c0);
  if (!c) { c = {verts: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0}; comps.set(c0, c); }
  c.verts.push(i);
  for (let k = 0; k < 3; k++) { c.min[k] = Math.min(c.min[k], shellRaw.pos[i * 3 + k]); c.max[k] = Math.max(c.max[k], shellRaw.pos[i * 3 + k]); }
}
for (let t = 0; t < shellRaw.idx.length; t += 3) comps.get(find(canon[shellRaw.idx[t]])).tris++;
const compList = [...comps.values()].sort((a, b) => b.tris - a.tris);
const body = compList[0];
const yWheel = Math.min(...compList.map(c => c.min[1]));
// wheel treads = the lowest vertices (one bogie frame has a wheel merged into it, so treads, not components, locate the wheels):
// bogie centre = the midpoint of its tread contacts along X, tread z = the mean |z| of the contacts
const treads = [];
for (let i = 0; i < nV; i++) if (shellRaw.pos[i * 3 + 1] < yWheel + 0.002) treads.push([shellRaw.pos[i * 3], shellRaw.pos[i * 3 + 2]]);
const wheelZ = (Math.min(...treads.map(p => Math.abs(p[1]))) + Math.max(...treads.map(p => Math.abs(p[1])))) / 2; // tread faces 0.052 / 0.058 raw
const bogieCx = [1, -1].map(sg => { const xs = treads.filter(p => Math.sign(p[0]) === sg).map(p => p[0]); return (Math.min(...xs) + Math.max(...xs)) / 2; });
const treadQuads = [1, -1].flatMap(sx => [1, -1].map(sz => treads.filter(p => Math.sign(p[0]) === sx && Math.sign(p[1]) === sz).length));
if (treadQuads.some(n => n < 4) || Math.abs(bogieCx[0] + bogieCx[1]) > 0.02 || !(wheelZ > 0.045 && wheelZ < 0.065)) fail(`unexpected wheel treads: ${treadQuads}, bogie centres ${bogieCx}, z ${wheelZ}`);
const bogieOf = c => {
  if (c === body || c.max[1] >= RAW.underside - 0.001 || Math.max(Math.abs(c.min[2]), Math.abs(c.max[2])) > RAW.bogieMaxZ) return -1;
  return bogieCx.findIndex(cx => c.min[0] >= cx - RAW.bogieHalfLen && c.max[0] <= cx + RAW.bogieHalfLen);
};
const B = FLOOR_Y - (RAW.sill - RAW.underside) * SY; // cooked height of the body underside
const SB = B / (RAW.underside - yWheel); // bogie x / y scale (uniform: round wheels)
const SBZ = RAIL_HALF_GAUGE / wheelZ; // bogie z scale: wheel treads on the running rails
const fy = y => B + (y - RAW.underside) * (y >= RAW.underside ? SY : S); // body / underframe vertical map (continuous)
// classOf: 0 / 1 bogie index, -1 body / upper fittings, -2 underframe (hung below the underside; a few tops reach <= 3 mm raw above
// the underside plane, inside the body: clamped onto it so nothing pokes through the interior floor)
const classOf = new Int8Array(nV).fill(-1);
const counts = {body: body.tris, bogie: [0, 0], underframe: 0, upper: 0};
for (const c of compList) {
  const b = bogieOf(c);
  if (b >= 0) { for (const i of c.verts) classOf[i] = b; counts.bogie[b] += c.tris; }
  else if (c !== body && c.min[1] < RAW.underside && c.max[1] < RAW.underside + 0.006) { for (const i of c.verts) classOf[i] = -2; counts.underframe += c.tris; }
  else if (c !== body) counts.upper += c.tris;
}
const cooked = {pos: new Array(nV * 3), nrm: new Array(nV * 3), uv: shellRaw.uv};
for (let i = 0; i < nV; i++) {
  const [x, y, z] = [shellRaw.pos[i * 3], shellRaw.pos[i * 3 + 1], shellRaw.pos[i * 3 + 2]];
  const [nx, ny, nz] = [shellRaw.nrm[i * 3], shellRaw.nrm[i * 3 + 1], shellRaw.nrm[i * 3 + 2]];
  let p, sc;
  if (classOf[i] >= 0) { const cx = bogieCx[classOf[i]]; p = [cx * S + (x - cx) * SB, (y - yWheel) * SB, z * SBZ]; sc = [SB, SB, SBZ]; }
  else if (classOf[i] === -2) { p = [x * S, fy(Math.min(y, RAW.underside)), z * S]; sc = [S, S, S]; }
  else { p = [x * S, fy(y), z * S]; sc = [S, y >= RAW.underside ? SY : S, S]; }
  const n = norm([nx / sc[0], ny / sc[1], nz / sc[2]]);
  for (let k = 0; k < 3; k++) { cooked.pos[i * 3 + k] = p[k]; cooked.nrm[i * 3 + k] = n[k]; }
}
// door rectangles (cooked) + the recess plane (leaf outer face) measured on the cooked skin before cutting
const doorRects = RAW.doors.map(([a, b]) => ({x0: a * S, x1: b * S, y0: fy(RAW.sill), y1: fy(RAW.doorTop)}));
/** The outermost skin |z| on `side` along the ray through (x, y) (cooked body / underframe triangles), or NaN. */
const skinTris = [];
for (let t = 0; t < shellRaw.idx.length; t += 3) { const ids = [0, 1, 2].map(j => shellRaw.idx[t + j]); if (ids.every(i => classOf[i] === -1)) skinTris.push(ids.map(i => [cooked.pos[i * 3], cooked.pos[i * 3 + 1], cooked.pos[i * 3 + 2]])); }
const skinZ = (x, y, side) => {
  let best = NaN;
  for (const [a, b, c] of skinTris) {
    if (Math.max(a[0], b[0], c[0]) < x || Math.min(a[0], b[0], c[0]) > x || Math.max(a[1], b[1], c[1]) < y || Math.min(a[1], b[1], c[1]) > y) continue;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / det, v = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const z = side * (a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]));
    if (z > 0 && !(z <= best)) best = z;
  }
  return best;
};
const median = a => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const recessZ = {[-1]: [], [1]: []}, beltZ = {[-1]: [], [1]: []};
for (const sd of [-1, 1]) for (const d of doorRects) for (const fx of [0.2, 0.35, 0.65, 0.8]) for (const fh of [0.08, 0.15, 0.3, 0.45]) {
  // the door panel's lower half (the upper half carries the door windows, set deeper)
  recessZ[sd].push(skinZ(d.x0 + fx * (d.x1 - d.x0), d.y0 + fh * (d.y1 - d.y0), sd));
  beltZ[sd].push(skinZ(d.x0 - 0.15 - fx * 0.2, d.y0 + fh * (d.y1 - d.y0), sd), skinZ(d.x1 + 0.15 + fx * 0.2, d.y0 + fh * (d.y1 - d.y0), sd));
}
const recess = {[-1]: median(recessZ[-1]), [1]: median(recessZ[1])}, skinBeside = {[-1]: median(beltZ[-1]), [1]: median(beltZ[1])};
for (const sd of [-1, 1]) if (!(skinBeside[sd] - recess[sd] > 0.03)) fail(`door recess not found on side ${sd}: recess ${recess[sd]} vs skin ${skinBeside[sd]}`);
// triangles, door cuts
// class tags (record slot 8): 0 the body component, 1 upper fittings (roof vents / end fittings), 2 underframe, 3 / 4 bogies
const bodyVert = new Uint8Array(nV); for (const i of body.verts) bodyVert[i] = 1;
const clsOf = i => classOf[i] >= 0 ? 3 + classOf[i] : classOf[i] === -2 ? 2 : bodyVert[i] ? 0 : 1;
let shellTris = [];
for (let t = 0; t < shellRaw.idx.length; t += 3) shellTris.push([0, 1, 2].map(j => [...vert(cooked, shellRaw.idx[t + j]), clsOf(shellRaw.idx[t + j])]));
// ---------- repair (before any cut): census, single coverage of near-coincident faces, degenerate faces ----------
const censusBefore = censusOf(shellTris, REPAIR);
// priority: body / fittings faces that face OUTWARD from the car's core first (largest first), then the undercarriage, then body
// faces turned INWARD (the Meshy fold flaps lying on the skin): those survive only where no outward face covers them
const coreClamp = c => [Math.max(-7.0, Math.min(7.0, c[0])), Math.max(1.6, Math.min(3.0, c[1])), Math.max(-0.8, Math.min(0.8, c[2]))];
const repairPriority = t => {
  if (t[0][8] >= 2) return 1;
  const c = [0, 1, 2].map(k => (t[0][k] + t[1][k] + t[2][k]) / 3), q = coreClamp(c), o = [c[0] - q[0], c[1] - q[1], c[2] - q[2]];
  const n = faceNormal(t), ol = Math.hypot(...o), nl = Math.hypot(...n);
  return ol > 1e-6 && nl > 0 && (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]) / (ol * nl) < -0.5 ? 2 : 0;
};
const repaired = resolveCoverageFull(shellTris, repairPriority, REPAIR);
shellTris = dropDegenerate(repaired.tris);
let removedArea = 0;
for (const sd of [-1, 1]) for (const d of doorRects) {
  const next = [];
  for (const t of shellTris) {
    const xs = t.map(v => v[0]), ys = t.map(v => v[1]);
    if (Math.max(...xs) <= d.x0 || Math.min(...xs) >= d.x1 || Math.max(...ys) <= d.y0 || Math.min(...ys) >= d.y1 || Math.max(...t.map(v => sd * v[2])) < CUT_MIN_Z) { next.push(t); continue; }
    const pieces = [clip(t, 0, d.x0, -1), clip(t, 0, d.x1, 1)];
    const mid = clip(clip(t, 0, d.x0, 1), 0, d.x1, -1);
    pieces.push(clip(mid, 1, d.y1, 1), clip(mid, 1, d.y0, -1));
    const inside = clip(clip(mid, 1, d.y1, -1), 1, d.y0, 1);
    if (inside.length) {
      const c = inside.reduce((s, v) => s + sd * v[2], 0) / inside.length;
      if (c > CUT_MIN_Z) removedArea += fanTris(inside).reduce((s, q) => s + triArea(q), 0);
      else pieces.push(inside);
    }
    for (const p of pieces) for (const q of fanTris(p)) if (triArea(q) > 1e-9) next.push(q);
  }
  shellTris = next;
}
// ---------- windows: measure the glass on the repaired surface, then cut straight through-holes ----------
const baseImg = await (async () => { const {data, info} = await sharp(Buffer.from(shellRaw.doc.getRoot().listMaterials()[0].getBaseColorTexture().getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; })();
const windowsSide = [], windowsEnd = [], windowsSkipped = [];
const leafW = Math.max(...doorRects.map(d => d.x1 - d.x0)) / 2 + LEAF.overlap;
const pockets = doorRects.flatMap(d => [[d.x0 - WINDOW.slide - leafW, d.x0 - WINDOW.slide], [d.x1 + WINDOW.slide, d.x1 + WINDOW.slide + leafW]]); // open-leaf x spans
for (const sd of [-1, 1]) for (const w of SIDE_WINDOW_SEARCH) {
  const r = rasterFace(shellTris, baseImg, {face: 'side', sign: sd, u0: w.x[0], u1: w.x[1], v0: WINDOW.y[0], v1: WINDOW.y[1], nMin: CUT_MIN_Z, px: WINDOW.px});
  const b = darkBox(r, {dark: WINDOW.dark});
  if (!b) fail(`no ${w.zone} window glass found on side ${sd} in x ${w.x}`);
  const rect = {u0: b.u0 + WINDOW.inset, u1: b.u1 - WINDOW.inset, v0: b.v0 + WINDOW.inset, v1: b.v1 - WINDOW.inset};
  const glass = {...rect};
  let trimmed = false;
  for (const [p0, p1] of pockets) {
    if (rect.u1 <= p0 - WINDOW.pocketClear || rect.u0 >= p1 + WINDOW.pocketClear) continue;
    trimmed = true;
    if ((p0 + p1) / 2 < (rect.u0 + rect.u1) / 2) rect.u0 = Math.max(rect.u0, p1 + WINDOW.pocketClear); else rect.u1 = Math.min(rect.u1, p0 - WINDOW.pocketClear);
  }
  if (trimmed && (rect.u1 - rect.u0 < WINDOW.minWidth || rect.u1 - rect.u0 < 0.6 * (glass.u1 - glass.u0))) { windowsSkipped.push({side: sd, zone: w.zone, glassX: [r3(glass.u0), r3(glass.u1)], why: 'an open door leaf parks in the wall pocket behind it'}); continue; }
  const skin = ringMin(rasterFace(shellTris, baseImg, {face: 'side', sign: sd, u0: rect.u0 - 0.1, u1: rect.u1 + 0.1, v0: rect.v0 - 0.1, v1: rect.v1 + 0.1, nMin: CUT_MIN_Z, px: WINDOW.px}), rect, WINDOW.ring);
  windowsSide.push({side: sd, zone: w.zone, x0: r3(rect.u0), x1: r3(rect.u1), y0: r3(rect.v0), y1: r3(rect.v1), skinZ: r3(Math.floor(skin * 1000) / 1000)});
}
for (const end of [1, -1]) for (const w of END_WINDOW_SEARCH) {
  const r = rasterFace(shellTris, baseImg, {face: 'end', sign: end, u0: w.z[0], u1: w.z[1], v0: WINDOW.y[0], v1: WINDOW.y[1], nMin: WINDOW.endCutMin, nMax: 7.95, px: WINDOW.px});
  const b = darkBox(r, {dark: WINDOW.dark});
  if (!b) fail(`no end window glass found at end ${end} in z ${w.z}`);
  const rect = {u0: Math.max(-WINDOW.endZMax, b.u0 + WINDOW.inset), u1: Math.min(WINDOW.endZMax, b.u1 - WINDOW.inset), v0: b.v0 + WINDOW.inset, v1: b.v1 - WINDOW.inset};
  const skin = ringMin(rasterFace(shellTris, baseImg, {face: 'end', sign: end, u0: rect.u0 - 0.1, u1: rect.u1 + 0.1, v0: rect.v0 - 0.1, v1: rect.v1 + 0.1, nMin: WINDOW.endCutMin, nMax: 7.95, px: WINDOW.px}), rect, WINDOW.ring);
  windowsEnd.push({end, z0: r3(rect.u0), z1: r3(rect.u1), y0: r3(rect.v0), y1: r3(rect.v1), skinX: r3(Math.floor(skin * 1000) / 1000)});
}
let windowArea = 0;
for (const w of windowsSide) { const c = cutRect(shellTris, {u: 0, v: 1, n: 2, u0: w.x0, u1: w.x1, v0: w.y0, v1: w.y1, sign: w.side, nMin: CUT_MIN_Z}); shellTris = c.tris; windowArea += c.removedArea; }
for (const w of windowsEnd) { const c = cutRect(shellTris, {u: 2, v: 1, n: 0, u0: w.z0, u1: w.z1, v0: w.y0, v1: w.y1, sign: w.end, nMin: WINDOW.endCutMin}); shellTris = c.tris; windowArea += c.removedArea; }
// the cuts split faces; resolve once more at that scale (cuts never create overlaps, but smaller pieces expose coincident ones), then
// recompute the normals from the final faces
const repaired2 = resolveCoverageFull(shellTris, repairPriority, REPAIR);
shellTris = creaseNormals(dropDegenerate(repaired2.tris), REPAIR.creaseDeg);
const censusAfter = censusOf(shellTris, REPAIR);
// the leaf plane: one leaf of a centre-opening pair for the widest doorway; its outer face sits just inside the innermost remaining
// skin over each opening and its sliding pocket (the recess jamb lips reach further in than the recess panel), so an open leaf
// never pokes through the skin
const widestDoor = Math.max(...doorRects.map(d => d.x1 - d.x0));
const leafSize = {width: r3(widestDoor / 2 + LEAF.overlap), height: r3(fy(RAW.doorTop) - fy(RAW.sill) + LEAF.top), thickness: LEAF.thickness};
let innerSkin = Infinity;
for (const sd of [-1, 1]) for (const d of doorRects) {
  const box = {x0: d.x0 - leafSize.width - 0.05, x1: d.x1 + leafSize.width + 0.05, y0: d.y0 + 0.005, y1: d.y1 + LEAF.top};
  for (const t of shellTris) {
    if (Math.min(...t.map(v => sd * v[2])) < CUT_MIN_Z) continue;
    const poly = clip(clip(clip(clip(t, 0, box.x0, 1), 0, box.x1, -1), 1, box.y0, 1), 1, box.y1, -1);
    for (const v of poly) innerSkin = Math.min(innerSkin, sd * v[2]);
  }
}
const leafOuterZ = r3(Math.floor((innerSkin - 0.006) * 1000) / 1000);
writeTris(shellRaw.doc, shellRaw.prim, shellTris);
const shellOut = await finishDoc(shellRaw.doc, 'player-train-shell', TEX.shell);

// ---------- measure the cooked shell + derive the spec ----------
const floorY = r3(fy(RAW.sill)), doorTopY = fy(RAW.doorTop);
const ceilingY = r3(floorY + CEILING_ABOVE_FLOOR);
const interior = {x0: -INTERIOR_HALF_LENGTH, x1: INTERIOR_HALF_LENGTH, halfWidth: INTERIOR_HALF_WIDTH};
const doors = [];
for (const d of [...doorRects].sort((p, q) => p.x0 - q.x0)) for (const side of [-1, 1]) doors.push({side, x: r3((d.x0 + d.x1) / 2), width: r3(d.x1 - d.x0), height: r3(doorTopY - floorY)});
const frontDoor = doorRects.reduce((m, d) => (d.x1 > m.x1 ? d : m));
const cab = {x0: r3(interior.x1 - CAB_DEPTH), x1: interior.x1, doorway: {z0: -CAB_DOORWAY.halfWidth, z1: CAB_DOORWAY.halfWidth, height: CAB_DOORWAY.height}};
// lamps on the end faces (measured: red lens centres at raw z +-0.049, y -0.0287 (lower) / 0.071 (upper), face x +-0.452)
const LAMP_RAW = {z: 0.049, lowerY: -0.0287, upperY: 0.0710, faceX: 0.452, radius: 0.0045};
const lamp = (end, y) => [-1, 1].map(sz => ({x: r3(end * (LAMP_RAW.faceX * S + LAMP_OFFSET)), y: r3(fy(y)), z: r3(sz * LAMP_RAW.z * S)}));
const saloon = [interior.x0, cab.x0];
const lights = {
  head: lamp(1, LAMP_RAW.lowerY), tail: lamp(-1, LAMP_RAW.lowerY),
  interior: [r3(saloon[0] + (saloon[1] - saloon[0]) * 0.25), r3(saloon[0] + (saloon[1] - saloon[0]) * 0.75), r3((cab.x0 + cab.x1) / 2)].map(x => ({x, y: r3(ceilingY - 0.04), z: 0})),
  lampRadius: r3(LAMP_RAW.radius * S),
  marker: {front: lamp(1, LAMP_RAW.upperY), rear: lamp(-1, LAMP_RAW.upperY)},
};

// containment checks on the FINAL triangles (cooked frame)
const finalShell = await io.readBinary(new Uint8Array(shellOut.glb));
const fp = finalShell.getRoot().listMeshes()[0].listPrimitives()[0];
const FP = fp.getAttribute('POSITION').getArray(), FI = fp.getIndices().getArray();
const finalTris = [];
for (let t = 0; t < FI.length; t += 3) finalTris.push([0, 1, 2].map(j => [FP[FI[t + j] * 3], FP[FI[t + j] * 3 + 1], FP[FI[t + j] * 3 + 2]]));
const checks = {
  interiorBox: boxHits(finalTris, {min: [interior.x0, floorY + 0.005, -interior.halfWidth], max: [interior.x1, ceilingY, interior.halfWidth]}),
  leafPockets: doors.map(d => boxHits(finalTris, {min: [d.x - d.width / 2 - leafSize.width, floorY + 0.005, d.side < 0 ? -(leafOuterZ - 0.003) : leafOuterZ - leafSize.thickness],
    max: [d.x + d.width / 2 + leafSize.width, floorY + d.height, d.side < 0 ? -(leafOuterZ - leafSize.thickness) : leafOuterZ - 0.003]})),
  openings: doors.map(d => boxHits(finalTris, {min: [d.x - d.width / 2 + 0.01, floorY + 0.01, d.side < 0 ? -2 : interior.halfWidth], max: [d.x + d.width / 2 - 0.01, floorY + d.height - 0.01, d.side < 0 ? -interior.halfWidth : 2]})),
  // every window is a clear straight through-hole from the lining out past the skin
  sideWindows: windowsSide.map(w => boxHits(finalTris, {min: [w.x0 + 0.01, w.y0 + 0.01, w.side < 0 ? -2 : interior.halfWidth], max: [w.x1 - 0.01, w.y1 - 0.01, w.side < 0 ? -interior.halfWidth : 2]})),
  endWindows: windowsEnd.map(w => boxHits(finalTris, {min: [w.end > 0 ? interior.x1 : -9, w.y0 + 0.01, w.z0 + 0.01], max: [w.end > 0 ? 9 : -interior.x1, w.y1 - 0.01, w.z1 - 0.01]})),
};
const wheelTreads = [];
for (let i = 0; i < nV; i++) if (classOf[i] >= 0 && shellRaw.pos[i * 3 + 1] < yWheel + 0.002) wheelTreads.push([cooked.pos[i * 3], cooked.pos[i * 3 + 1], cooked.pos[i * 3 + 2]]);
const treadZ = [-1, 1].map(sd => { const zs = wheelTreads.filter(p => Math.sign(p[2]) === sd).map(p => Math.abs(p[2])); return r4((Math.min(...zs) + Math.max(...zs)) / 2); });
const coverboardClear = r3(Math.min(...finalTris.filter(t => t.some(p => p[2] > 1.24)).flatMap(t => t.filter(p => p[2] > 1.24).map(p => p[1]))));
const fit = {
  width: shellOut.dims[2], length: shellOut.dims[0], floorAbovePlatform: r3(floorY - 0.855), doorClear: doors[0].height, ceilingAboveFloor: r3(ceilingY - floorY),
  wheelTreadZ: treadZ, minY: shellOut.bounds.min[1], platformGap: r3(2.0 - shellOut.bounds.max[2]),
};
const problems = [];
if (checks.interiorBox) problems.push(`shell triangles inside the interior box: ${checks.interiorBox}`);
checks.leafPockets.forEach((n, i) => n && problems.push(`door ${i} leaf pocket hits ${n} shell triangles`));
checks.openings.forEach((n, i) => n && problems.push(`door ${i} opening still has ${n} shell triangles`));
if (!(fit.width >= 2.9 && fit.width <= 3.1)) problems.push(`width ${fit.width}`);
if (!(fit.length <= 16.5)) problems.push(`length ${fit.length}`);
if (!(fit.floorAbovePlatform >= 0.05 && fit.floorAbovePlatform <= 0.25)) problems.push(`floor ${fit.floorAbovePlatform} above the platform`);
if (!(fit.doorClear >= 1.95)) problems.push(`door clear ${fit.doorClear}`);
if (!(fit.ceilingAboveFloor >= 2.25)) problems.push(`ceiling ${fit.ceilingAboveFloor}`);
if (treadZ.some(z => Math.abs(z - RAIL_HALF_GAUGE) > 0.01)) problems.push(`wheel treads at ${treadZ}`);
if (Math.abs(fit.minY) > 1e-3) problems.push(`not on the rail plane: min y ${fit.minY}`);
if (cab.x0 < frontDoor.x1 + 0.25) problems.push(`cab partition ${cab.x0} too close to the front door edge ${frontDoor.x1}`);
checks.sideWindows.forEach((n, i) => n && problems.push(`side window ${i} still has ${n} shell triangles`));
checks.endWindows.forEach((n, i) => n && problems.push(`end window ${i} still has ${n} shell triangles`));
for (const w of windowsSide) {
  if (w.zone === 'cab' && (w.x0 < cab.x0 + 0.05 || w.x1 > interior.x1)) problems.push(`cab window ${w.x0}..${w.x1} outside the cab`);
  if (w.y0 < floorY + 0.5 || w.y1 > ceilingY) problems.push(`side window y ${w.y0}..${w.y1} outside the wall`);
  if (!(w.skinZ > interior.halfWidth)) problems.push(`side window skin ${w.skinZ} inside the lining`);
  for (const [p0, p1] of pockets) if (w.x1 > p0 - WINDOW.pocketClear + 1e-9 && w.x0 < p1 + WINDOW.pocketClear - 1e-9) problems.push(`side window ${w.x0}..${w.x1} over a leaf pocket ${p0}..${p1}`);
}
for (const w of windowsEnd) if (w.z0 < -interior.halfWidth || w.z1 > interior.halfWidth || w.y0 < floorY + 0.5 || w.y1 > ceilingY || !(w.skinX > interior.x1)) problems.push(`end window ${JSON.stringify(w)} outside the end wall`);
if (windowsEnd.length !== 6) problems.push(`expected 3 windows per end face, cut ${windowsEnd.length}`);
for (const k of ['degenerate', 'normalFlip', 'foldOverlaps', 'duplicateOverlaps']) if (censusAfter[k]) problems.push(`repair left ${censusAfter[k]} ${k}`);

// ======================================================================================================================
// DOOR LEAF (clean +Z half, mirrored)
// ======================================================================================================================
const leafRaw = await readRaw(accepted.leaf.buf);
const lp = leafRaw.pos, lzMin = Math.min(...lp.filter((_, i) => i % 3 === 2)), lzMax = Math.max(...lp.filter((_, i) => i % 3 === 2));
// the flat -Z face (the baked figure) is the plane z = lzMin; the clean +Z glass at ~-0.008; the mid-plane between them
const LEAF_ZC = -0.0155;
let leafTris = [];
for (let t = 0; t < leafRaw.idx.length; t += 3) {
  const tri = [0, 1, 2].map(j => vert(leafRaw, leafRaw.idx[t + j]));
  for (const q of fanTris(clip(tri, 2, LEAF_ZC, 1))) if (triArea(q) > 1e-12) leafTris.push(q);
}
const keptLeafTris = leafTris.length;
const leafHasFigureFace = leafTris.some(t => t.every(v => v[2] < LEAF_ZC + 1e-6));
if (leafHasFigureFace || !(lzMin < LEAF_ZC - 0.006)) fail('door leaf: the -Z face was not removed');
// LOD: decimate the clean half by position, planar front UV, crease-angle normals; bake the Meshy maps of the clean half onto it
const leafBox = {x0: Math.min(...leafTris.flatMap(t => t.map(v => v[0]))), x1: Math.max(...leafTris.flatMap(t => t.map(v => v[0]))),
  y0: Math.min(...leafTris.flatMap(t => t.map(v => v[1]))), y1: Math.max(...leafTris.flatMap(t => t.map(v => v[1])))};
const leafHalf = shadePlanar(await decimatePositions(leafTris, LEAF_LOD.targetHalfTriangles, LEAF_LOD.error), LEAF_LOD.creaseDeg, leafBox);
if (leafHalf.some(t => t.some(v => v[2] < LEAF_ZC - 1e-7))) fail('door leaf: decimation moved geometry past the mid-plane');
const leafMat = leafRaw.doc.getRoot().listMaterials()[0];
const decodeMap = async tex => { const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; };
const leafBake = await bakePlanar(leafTris, {base: await decodeMap(leafMat.getBaseColorTexture()), mr: await decodeMap(leafMat.getMetallicRoughnessTexture()), normal: await decodeMap(leafMat.getNormalTexture())}, leafBox, LEAF_LOD.bake);
if (leafBake.misses) fail(`door leaf bake: ${leafBake.misses} texels without a source surface`);
const jpegMap = async (raw, size) => { const {w, h} = LEAF_LOD.bake; let img = sharp(raw, {raw: {width: w, height: h, channels: 3}}); if (size[0] !== w) img = img.resize(size[0], size[1], {kernel: 'lanczos3', fit: 'fill'}); return img.jpeg({quality: TEX.leaf.quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer(); };
leafMat.getBaseColorTexture().setImage(await jpegMap(leafBake.base, TEX.leaf.base)).setMimeType('image/jpeg');
leafMat.getMetallicRoughnessTexture().setImage(await jpegMap(leafBake.mr, TEX.leaf.mr)).setMimeType('image/jpeg');
leafMat.getNormalTexture().setImage(await jpegMap(leafBake.normal, TEX.leaf.normal)).setMimeType('image/jpeg');
const simplifiedLeafHalf = leafHalf.length;
leafTris = [...leafHalf, ...leafHalf.map(t => [t[0], t[2], t[1]].map(v => [v[0], v[1], 2 * LEAF_ZC - v[2], v[3], v[4], -v[5], v[6], v[7]]))];
{ // the mirrored halves meet exactly: no open edge on the mid-plane
  const k = v => `${Math.round(v[0] * 1e7)},${Math.round(v[1] * 1e7)},${Math.round(v[2] * 1e7)}`, edges = new Map();
  for (const t of leafTris) for (let j = 0; j < 3; j++) { const a = k(t[j]), b = k(t[(j + 1) % 3]); if (a === b) continue; const e = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(e, (edges.get(e) ?? 0) + 1); }
  const zcKey = Math.round(LEAF_ZC * 1e7);
  const openOnPlane = [...edges].filter(([e, n]) => n === 1 && e.split('|').every(p => Math.abs(+p.split(',')[2] - zcKey) <= 1)).length;
  if (openOnPlane) fail(`door leaf: ${openOnPlane} open edges on the mid-plane after mirroring`);
}
const leafFit = fitTris(leafTris, size => [leafSize.width / size[0], leafSize.height / size[1], leafSize.thickness / size[2]]);
leafTris = leafFit.tris;
const leafScale = leafFit.scale.map(r4);
// ---------- the leaf's window: through-cut of both glass faces inside the frame rim, the closing-edge stile (T-handle) kept ----------
const isGlassFace = t => { const n = faceNormal(t), l = Math.hypot(...n); return l > 0 && Math.abs(n[2] / l) > 0.9 && t.every(v => Math.abs(v[2]) < 0.0075); };
const isRimFace = t => { const n = faceNormal(t), l = Math.hypot(...n); return l > 0 && Math.abs(n[2] / l) > 0.9 && t.every(v => Math.abs(v[2]) > 0.012); };
const leafWindow = (() => {
  const rim = leafTris.filter(t => isRimFace(t) && t[0][2] > 0);
  const hw = leafSize.width / 2;
  // inner edges of the rim strips: left / right along the mid-height band, top along the centre band
  const band = (lo, hi, k) => rim.filter(t => Math.max(...t.map(v => v[k])) >= lo && Math.min(...t.map(v => v[k])) <= hi); // rim strips span the leaf
  const midBand = band(1.2, 1.6, 1), cBand = band(-0.1, 0.1, 0);
  const left = Math.max(...midBand.flatMap(t => t.map(v => v[0])).filter(x => x < 0)), right = Math.min(...midBand.flatMap(t => t.map(v => v[0])).filter(x => x > 0));
  const top = Math.min(...cBand.flatMap(t => t.map(v => v[1])).filter(y => y > 1.0));
  // the T-handle: geometry standing proud of the glass inside the rim; its backplate = the x bins whose vertical extent > 0.1 m
  const proud = leafTris.flatMap(t => t).filter(v => v[2] > 0.0075 && v[0] > left + 0.005 && v[0] < right - 0.005 && v[1] > 0.3 && v[1] < 1.7);
  const bins = new Map();
  for (const v of proud) { const b = Math.floor(v[0] / 0.005); const e = bins.get(b) ?? [Infinity, -Infinity]; bins.set(b, [Math.min(e[0], v[1]), Math.max(e[1], v[1])]); }
  const plate = [...bins].filter(([, [a, b]]) => b - a > 0.1).map(([b]) => b * 0.005);
  if (!(left < -0.2 && left > -0.3 && right > 0.2 && right < 0.3 && top > 1.8 && top < 2.0 && plate.length && Math.min(...plate) > 0)) fail(`door leaf window: unexpected frame (rim ${left}, ${right}, top ${top}, handle plate ${plate})`);
  return {x0: r3(left + LEAF_WINDOW.rimMargin), x1: r3(Math.min(right - LEAF_WINDOW.rimMargin, Math.min(...plate) - LEAF_WINDOW.stileGap)), y0: LEAF_WINDOW.bottom, y1: r3(top - LEAF_WINDOW.topMargin), rim: [r4(left), r4(right), r4(top)], plateX0: r4(Math.min(...plate)), halfWidth: hw};
})();
{
  // the glass layer: its +-Z faces, plus any small detail on it (rivet facets) lying wholly inside the window (no floating bits remain)
  const inWin = t => t.every(v => Math.abs(v[2]) < 0.0075 && v[0] > leafWindow.x0 && v[0] < leafWindow.x1 && v[1] > leafWindow.y0 && v[1] < leafWindow.y1);
  const strays = leafTris.filter(t => !isGlassFace(t) && inWin(t));
  const glass = leafTris.filter(isGlassFace), rest = leafTris.filter(t => !isGlassFace(t) && !inWin(t));
  leafWindow.strayFacets = strays.length;
  let g = glass, cutArea = 0;
  for (const sign of [1, -1]) { const c = cutRect(g, {u: 0, v: 1, n: 2, u0: leafWindow.x0, u1: leafWindow.x1, v0: leafWindow.y0, v1: leafWindow.y1, sign, nMin: 0}); g = c.tris; cutArea += c.removedArea; }
  leafTris = [...rest, ...g];
  leafWindow.cutArea = r3(cutArea);
}
writeTris(leafRaw.doc, leafRaw.prim, leafTris);
leafRaw.doc.getRoot().listMaterials().forEach(m => m.setDoubleSided(true));
const leafOut = await finishDoc(leafRaw.doc, 'player-train-door-leaf', TEX.leaf);

// ======================================================================================================================
// CONSOLE (operator side -> -X, uniform scale)
// ======================================================================================================================
const conRaw = await readRaw(accepted.console.buf);
const conTris = fitTris(Array.from({length: conRaw.idx.length / 3}, (_, t) => [0, 1, 2].map(j => {
  const v = vert(conRaw, conRaw.idx[t * 3 + j]);
  return [-v[2], v[1], v[0], -v[5], v[4], v[3], v[6], v[7]]; // -90 deg about Y: native +Z (operator side) -> -X
})), () => [CONSOLE.scale, CONSOLE.scale, CONSOLE.scale]).tris;
writeTris(conRaw.doc, conRaw.prim, conTris);
const conOut = await finishDoc(conRaw.doc, 'player-train-console', TEX.console);
const consoleSpec = {x: r3(interior.x1 - conOut.dims[0] / 2 - CONSOLE.frontGap), z: 0, yaw: 0, scale: 1};
if (conOut.dims[2] > 2 * interior.halfWidth - 0.4) problems.push(`console ${conOut.dims[2]} m wide does not fit the cab`);
if (consoleSpec.x - conOut.dims[0] / 2 < cab.x0 + 1.0) problems.push('console leaves < 1 m standing room in the cab');

// ======================================================================================================================
// CODEX TEXTURES (resize + format conversion only)
// ======================================================================================================================
const texOut = [];
for (const s of codex) {
  const jpg = await sharp(s.buf).removeAlpha().toColourspace('srgb').resize(TEX.codex.size, TEX.codex.size, {kernel: 'lanczos3', fit: 'fill'})
    .jpeg({quality: TEX.codex.quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  texOut.push({s, jpg, rel: `${TEX_DIR}/${s.id}.jpg`});
}

if (problems.length) { console.error(JSON.stringify({fit, checks, problems}, null, 1)); fail('measured car violates the fit constraints'); }

// ======================================================================================================================
// spec + provenance + generated TS
// ======================================================================================================================
const measured = {
  length: fit.length, width: fit.width, floorY, ceilingY, roofY: shellOut.bounds.max[1], interior, cab, doors, console: consoleSpec, lights,
  doorLeaf: {outerZ: leafOuterZ, ...leafSize},
  windows: {side: windowsSide, end: windowsEnd, leaf: {x0: leafWindow.x0, x1: leafWindow.x1, y0: leafWindow.y0, y1: leafWindow.y1}},
};
const files = {
  'player-train-shell': {url: MODEL.shell, out: shellOut}, 'player-train-door-leaf': {url: MODEL.leaf, out: leafOut}, 'player-train-console': {url: MODEL.console, out: conOut},
};
const derivation = {
  shell: {frame: 'raw +X end = front (+X), raw -Z side = platform (-Z); no turn, no mirror', scale: {bodyXZ: S, bodyYAboveUnderside: SY, bodyYBelowUnderside: S, underframe: S, bogieXY: r4(SB), bogieZ: r4(SBZ)},
    rawPlanes: {underside: RAW.underside, sill: RAW.sill, doorTop: RAW.doorTop, wheelBottom: r4(yWheel), wheelTreadZ: r4(wheelZ), bogieCentresX: bogieCx.map(r4)},
    cookedUndersideY: r4(B), components: {total: compList.length, triangles: counts}, doorCuts: {rawX: RAW.doors, sides: [-1, 1], removedAreaM2: r3(removedArea), innerSkinZ: r4(innerSkin), recessPlaneZ: {platform: r4(recess[-1]), far: r4(recess[1])}, skinBesideZ: {platform: r4(skinBeside[-1]), far: r4(skinBeside[1])}},
    checks, fit, coverboardClearance: {minYAboveRailOutboard124: coverboardClear, coverboardTop: 0.185},
    repair: {method: 'single coverage of near-coincident parallel faces (|cos| >= ' + REPAIR.cos + ', planes within ' + REPAIR.gap + ' m): faces in priority order (outward body / fitting faces, undercarriage, inward body faces = Meshy fold flaps; larger first), each clipped against the kept faces it overlaps (no vertex moved, attributes interpolated, covered area kept); degenerate faces dropped; vertex normals recomputed from the final faces with a ' + REPAIR.creaseDeg + ' deg crease',
      census: {before: censusBefore, after: censusAfter}, passes: [repaired.passes, repaired2.passes], clippedTriangles: repaired.clippedTriangles + repaired2.clippedTriangles, removedOverlapAreaM2: r3(repaired.removedArea + repaired2.removedArea)},
    windows: {method: 'the dark glass (base colour luminance < ' + WINDOW.dark + ') inside per-window search boxes on the repaired surface, raster ' + WINDOW.px + ' m; rect = glass box inset ' + WINDOW.inset + ' m (the gasket stays); side windows kept ' + WINDOW.pocketClear + ' m clear of the open-leaf wall pockets; straight through-cuts (|z| > ' + CUT_MIN_Z + ' / |x| > ' + WINDOW.endCutMin + '); skinZ / skinX = the innermost skin on a ' + WINDOW.ring + ' m ring around each cut',
      removedAreaM2: r3(windowArea), skipped: windowsSkipped}},
  doorLeaf: {window: {...leafWindow, method: 'both glass faces (|n.z| > 0.9, |z| < 7.5 mm) clipped out inside the frame rim (inner edges + ' + LEAF_WINDOW.rimMargin + ' m), below the top rim (- ' + LEAF_WINDOW.topMargin + ' m), from y ' + LEAF_WINDOW.bottom + '; the closing-edge stile carrying the T-handle backplate kept (' + LEAF_WINDOW.stileGap + ' m gap); collision unchanged (lane TRAIN keeps the leaf box)'},
    method: 'clipped at the slab mid-plane z = -0.0155 raw, the clean +Z half kept and mirrored onto -Z (same UVs); the -Z face with the baked figure removed (its atlas region is never sampled)',
    rawZ: [r4(lzMin), r4(lzMax)], keptTriangles: keptLeafTris, lod: {...LEAF_LOD, tool: 'meshoptimizer simplify by position on the kept half (borders collapse only along themselves: the mid-plane loop stays on the plane), crease-angle normals, planar front UV; base colour / metallic-roughness / normal re-baked from the clean half by an orthographic +Z projection (normals re-expressed in the new tangent frame); then mirrored', halfTriangles: simplifiedLeafHalf, sourceHalfTriangles: keptLeafTris}, scale: leafScale, frame: 'grounded, centred, closing edge (T-handle) at +X, faces +-Z; one leaf of a centre-opening pair (mirror x for the other leaf)'},
  console: {method: 'turned -90 deg about Y (native operator side +Z -> -X), uniform scale', scale: CONSOLE.scale, frame: 'grounded, centred; operator side -X, windshield side +X, width along Z'},
};
const prov = {schema: 'last-line-derivative/1', asset: 'player-train-20261101', task: TASK, lane: 'ASSETS (Studio Beta player train)',
  status: "runtime derivatives of THREE models generated for this project with Meshy T2.5 (smart-topology text-to-3D preview + 2K PBR refine) through the Meshy MCP and FOUR interior textures generated with Codex native image_gen (owned Codex CLI), under the user's player-train authorization (up to 300 Meshy credits; the task used 50); provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  rebuild: 'node tools/asset-pipeline/train/build-player-train.mjs',
  rawStorage: `${TASK_DIR}/meshy/{raw/, LEDGER.jsonl, MANIFEST.json, RAW-SHA256.txt} + ${TASK_DIR}/codex/<id>/{<id>-original.png, receipt.json, prompt.txt} + SOURCES-SHA256.txt (read-only raw masters, outside Git)`,
  frame: 'train-local: origin = car centre on the track centre line at rail-top height, +X front (cab), +Y up, -Z platform side; metres',
  modelProof: {requested: {ai_model: manifest.preview.ai_model, model_type: manifest.preview.model_type, topology: manifest.preview.topology, target_polycount: manifest.preview.target_polycount,
    refine: 'enable_pbr true, texture_resolution 2k, ai_model omitted (inherits the T2.5 preview)'}, evidence: ['exact create arguments recorded in the fsynced ledger intent lines before each paid call; acks carry the task ids', 'previews billed 5 credits each (the T2 / T2.5 tier), refines 10']},
  ledger: {attempts: last.attempts, attemptedPOSTs: last.attemptedPOSTs, accepted: last.accepted, credits: {billed: last.billed, reserved: last.reserved, ceiling: open.ceilings.billedPlusReserved}, close: close.note},
  models: Object.fromEntries(Object.entries(PARTS).map(([k, part]) => {
    const a = accepted[k], f = files[{shell: 'player-train-shell', leaf: 'player-train-door-leaf', console: 'player-train-console'}[k]];
    return [part, {prompt: manifest.parts[part].prompt_a2b ?? manifest.parts[part].prompt, texturePrompt: manifest.refineTexturePrompts[part], tasks: {preview: a.preview, refine: a.task}, billed: a.billed,
      source: {file: a.file, bytes: a.buf.length, sha256: a.sha256, previewSha256: a.previewSha256},
      derivative: {dims: f.out.dims, triangles: f.out.tris, meshes: f.out.meshes, materials: f.out.materials, textures: f.out.textures, gpuBytesWithMips: f.out.gpuBytesWithMips, texturePolicy: TEX[k]},
      output: {url: f.url, bytes: f.out.glb.length, sha256: sha(f.out.glb)}}];
  })),
  derivation,
  textures: texOut.map(({s, jpg, rel}) => ({id: s.id, subject: s.subject, source: {file: s.file, sha256: s.r.sha256, bytes: s.r.bytes, width: s.r.width, height: s.r.height},
    codex: {generator: 'Codex native image_gen (owned Codex CLI)', threadId: s.r.codexThreadId, nativeSha256Matches: s.r.nativeSha256Matches, exit: Number(s.r.codexExit), launched: s.r.launched, finished: s.r.finished},
    prompt: s.prompt, recipe: {resize: `${TEX.codex.size} x ${TEX.codex.size} lanczos3 (square source, nothing cropped)`, encode: `jpeg q${TEX.codex.quality} mozjpeg 4:2:0, metadata stripped`},
    output: {url: rel, bytes: jpg.length, sha256: sha(jpg), width: TEX.codex.size, height: TEX.codex.size}})),
  measured};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/).{0,20}/i); if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`); }

const lit = v => JSON.stringify(v).replace(/"(\w+)":/g, '$1: ').replace(/,(?=[^\s])/g, ', ').replace(/"/g, "'");
const gen = `// GENERATED by tools/asset-pipeline/train/build-player-train.mjs — do not edit (task ${TASK}, lane ASSETS).
// The level-one player train: Meshy T2.5 shell / door leaf / driving desk + Codex interior textures (provenance ${PROV_REL}).
// Train-local frame: origin = car centre on the track centre line at RAIL-TOP height, +X front (cab), +Y up, -Z platform side.
// Shared runtime files (every station level parks the car). Models are baked at their runtime size in their own frames:
//   shell: train-local (place at the car origin);  door leaf: ONE leaf of a centre-opening pair, grounded / centred, closing edge
//   (T-handle) at +X, faces +-Z (mirror x for the other leaf);  console: grounded / centred, operator side -X, width along Z.
export const PLAYER_TRAIN_MODELS = {
${Object.entries(files).map(([key, f]) => `  '${key}': {key: '${key}', url: '${f.url}', bytes: ${f.out.glb.length}, tris: ${f.out.tris}, dims: [${f.out.dims.join(', ')}] as const},`).join('\n')}
} as const;

/** Interior textures (Codex sources, 1024 px sRGB JPEG): the wall is one window bay (tile along the car), floor / ceiling tile in
 *  2D, the bulkhead is one end-wall panel with a central closed door. */
export const PLAYER_TRAIN_TEXTURES = {
${texOut.map(o => `  '${o.s.id}': {url: '${o.rel}', bytes: ${o.jpg.length}, size: [${TEX.codex.size}, ${TEX.codex.size}] as const, srgb: true},`).join('\n')}
} as const;

/** Measured on the cooked shell (see the provenance 'derivation'); world/playerTrainSpec.ts PLAYER_TRAIN_SPEC reads this. */
export const PLAYER_TRAIN_MEASURED = {
  length: ${measured.length}, width: ${measured.width}, floorY: ${measured.floorY}, ceilingY: ${measured.ceilingY}, roofY: ${measured.roofY},
  interior: ${lit(measured.interior)},
  cab: ${lit(measured.cab)},
  doors: [
${measured.doors.map(d => `    {side: ${d.side} as const, x: ${d.x}, width: ${d.width}, height: ${d.height}},`).join('\n')}
  ],
  console: ${lit(measured.console)},
  lights: {
    head: ${lit(measured.lights.head)},
    tail: ${lit(measured.lights.tail)},
    interior: ${lit(measured.lights.interior)},
    lampRadius: ${measured.lights.lampRadius},
    marker: {front: ${lit(measured.lights.marker.front)}, rear: ${lit(measured.lights.marker.rear)}},
  },
  doorLeaf: ${lit(measured.doorLeaf)},
  windows: {
    side: [
${measured.windows.side.map(w => `      {side: ${w.side} as const, zone: '${w.zone}' as const, x0: ${w.x0}, x1: ${w.x1}, y0: ${w.y0}, y1: ${w.y1}, skinZ: ${w.skinZ}},`).join('\n')}
    ],
    end: [
${measured.windows.end.map(w => `      {end: ${w.end} as const, z0: ${w.z0}, z1: ${w.z1}, y0: ${w.y0}, y1: ${w.y1}, skinX: ${w.skinX}},`).join('\n')}
    ],
    leaf: ${lit(measured.windows.leaf)},
  },
} as const;
`;

// ---------- CREDITS + allowlist ----------
const credPath = path.join(PUB, CREDITS_REL);
const credSrc = fs.readFileSync(credPath, 'utf8');
const credSection = [CREDITS_BEGIN, '## Player train (level one): car shell, driving desk, door leaf, interior textures', '',
  `Models generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's player-train authorization (${last.attempts} attempts, ${last.billed} credits of up to ${open.ceilings.billedPlusReserved}); interior textures generated with Codex native image generation (the owned Codex CLI's built-in image_gen tool). Runtime derivatives (mesh processing: body stretched to human scale with the undercarriage unstretched, door openings and see-through window openings cut, Meshy's folded / duplicate overlapping faces removed and the normals recomputed, the leaf rebuilt from its clean face and decimated with its own maps re-baked onto a planar UV and its window cut; otherwise texture resize / format conversion only) built by \`tools/asset-pipeline/train/build-player-train.mjs\` (provenance: \`${PROV_REL}\`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters are kept outside Git.`, '',
  `- \`${MODEL.shell}\` — weathered subway car shell (Meshy tasks ${accepted.shell.preview} / ${accepted.shell.task})`,
  `- \`${MODEL.console}\` — cab driving desk (Meshy tasks ${accepted.console.preview} / ${accepted.console.task})`,
  `- \`${MODEL.leaf}\` — sliding door leaf (Meshy tasks ${accepted.leaf.preview} / ${accepted.leaf.task})`,
  ...texOut.map(o => `- \`${o.rel}\` — ${o.s.subject} (Codex thread ${o.s.r.codexThreadId})`), CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`;
const outFiles = [...Object.values(files).map(f => ({path: f.url, buf: f.out.glb})), ...texOut.map(o => ({path: o.rel, buf: o.jpg})), {path: PROV_REL, buf: provBuf}, {path: CREDITS_REL, buf: Buffer.from(credNext)}];
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outFiles.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outFiles.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

console.log(JSON.stringify({task: TASK, fit, checks, derivation: {shell: derivation.shell.scale, cookedUndersideY: derivation.shell.cookedUndersideY, counts, coverboard: coverboardClear, doorRecess: derivation.shell.doorCuts.recessPlaneZ},
  models: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, {bytes: f.out.glb.length, tris: f.out.tris, dims: f.out.dims, gpuMiB: +(f.out.gpuBytesWithMips / 1048576).toFixed(1)}])),
  textures: texOut.map(o => ({id: o.s.id, bytes: o.jpg.length})), measured}, null, 1));

if (CHECK) {
  const diff = [...outFiles.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(GEN) && fs.readFileSync(GEN, 'utf8') === gen ? [] : ['game/src/assets/playerTrain.generated.ts']),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-player-train: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, TEX_DIR), {recursive: true});
for (const f of outFiles) fs.writeFileSync(path.join(PUB, f.path), f.buf);
fs.writeFileSync(GEN, gen);
fs.writeFileSync(ALLOW, allowText);
console.log('build-player-train: wrote', outFiles.length - 1, 'public files + CREDITS.md, playerTrain.generated.ts, public-inputs.json');
