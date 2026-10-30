// Task studio-beta-office-overhaul-20261030-01 (Studio Beta, lane ASSETS): runtime derivatives of the Meshy T2.5 (smart-topology)
// company signature props (D01-D40, 20 companies x 2) and supporting office-overhaul models (E01-E18).
//
// Reads the primary-authored finite manifest (sha256-pinned), the fsynced job ledger and the immutable raw originals kept OUTSIDE
// Git in reference/tasks/office-overhaul-20261030/assets/{manifest.json,ledger.jsonl,raw/<id>/...} (verifies every raw file against
// the ledger's sha256), never modifies them, and writes deterministically:
//   game/public/assets/models/office-<id>.glb                 (flat: tools/release/package-ci.mjs only allows assets/models/<name>.glb)
//   game/public/assets/derivatives/office-overhaul-20261030.json (provenance; no URLs / tokens)
//   tools/release/public-inputs.json                          (ONLY this task's paths are added/updated; every other entry untouched)
//   game/src/assets/companyAssets.ts                          (the GENERATED block only)
//   game/src/assets/companyDims.generated.ts                  (the GENERATED block only; three.js-free dims + nominal specs)
//   reference/.../assets/DELIVERED.json                       (delivery note for the gameplay lanes; atomic)
//
// Only ACCEPTED refines are built: the ledger must hold an `inspect` line {verdict: 'accepted', kind: 'refine', task_id, front} written
// after the CPU orthographic review of the refined native GLB (tools/asset-pipeline/props/lib/ortho-render.mjs). `front` is the
// native front direction seen on those views (Meshy's is normally +Z).
// Model derivative = rotate about Y so the native front faces -Z (game convention), uniform scale to the manifest's real size
// (sizeAxis h = height y, w = width x after rotation, longest = longest extent), grounded (min y = 0) and centred on x/z, baked into
// the vertices (identity nodes). No geometry simplification (Smart Topology already produced the target triangle count). The native
// 2K PBR material is preserved channel for channel (base colour, metallic-roughness, normal) and downsized per the iteration-16
// texture policy (sharp Lanczos, JPEG q85): base colour 1024 for large pieces (nominal max extent >= 1.5 m) else 512, the other maps
// 512; a deterministic step-down ladder keeps every GLB under its byte budget (large 600 kB, small 400 kB).
//
// Usage: node tools/asset-pipeline/props/build-office-overhaul.mjs [--only D01,E05]   (--only rebuilds a subset; the registry,
//        provenance, allowlist and DELIVERED.json always describe every delivered asset)
//        [--allowlist-out <file>]  write this task's allowlist entries to <file> instead of rewriting tools/release/public-inputs.json
//        [--no-delivered]          leave reference/.../DELIVERED.json (the original delivery note) untouched
//        env FURN_GHOST_DEBUG=<dir>  QA dumps of the support-texture cleanup (mask / ghosts / filled base map per separated asset)
//
// Task office-props-physics-scale-20261030 (lane FURN): FURNITURE-ONLY real size + LOCAL CLUTTER SEPARATION (no regeneration; the
// pinned manifest, ledger and raw originals are unchanged). User: the lab bench "appears to small, almost like a mini version", "all the
// beakers and lab equipment on top are part of the model, they shouldn't be ... cut out in to there own assets", the bakery case's bread
// "should be a food item", the bean bag is "to small", the curved monitor desk "is to small, and monitors are baked in to desk model".
// Root cause of the miniatures: the manifest sizes the lab bench / trading desk by their WIDTH, and the models came out far wider than
// a real bench / desk for their height (worktops 0.54 / 0.37 m). FURNITURE[id] now sizes the FURNITURE ITSELF (worktop / desk top /
// overall height, never a box that includes loose beakers or monitors): the derivative is first built exactly as before (manifest
// frame), then lib/clutter-split.mjs separates the baked clutter (connected components standing on the worktop / desk top / display
// shelves), the body is rescaled by k = FURNITURE.sizeM / its own extent, and one representative of each distinct loose object type is
// written as its own small model at ITS OWN real size (office-<part>.glb; the bread loaf item-bread-t25.glb) with a crop of the atlas.
// The registry's sizeM / sizeAxis are the furniture-only values; the manifest's stay in the provenance (manifestSizeM).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';
import {GLASS_MATERIAL, cleanSupportTexture, cropPartTextures, extentOf, scaleGroundCentre, splitClutter, splitGlass} from './lib/clutter-split.mjs'; // lane FURN (office-props-physics-scale-20261030)

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-office-overhaul-20261030-01';
const TASK_DIR = 'reference/tasks/office-overhaul-20261030';
const ASSETS_DIR = path.join(root, TASK_DIR, 'assets');
const MANIFEST = path.join(ASSETS_DIR, 'manifest.json');
const MANIFEST_SHA = 'c55dd4bcfdbab86e3c8e2b50119a38f57d5dfab6151e120476439c68198520c5';
const LEDGER = path.join(ASSETS_DIR, 'ledger.jsonl');
const OUT_MODELS = path.join(root, 'game/public/assets/models');
const PROV_REL = 'assets/derivatives/office-overhaul-20261030.json';
const PROV = path.join(root, 'game/public', PROV_REL);
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const REGISTRY = path.join(root, 'game/src/assets/companyAssets.ts');
const DIMS_TS = path.join(root, 'game/src/assets/companyDims.generated.ts');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS = path.join(root, 'game/public', CREDITS_REL);
const CREDITS_MARK = '## Office overhaul: company tenant props and supporting models';
const DELIVERED = path.join(ASSETS_DIR, 'DELIVERED.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const outRelOf = id => `assets/models/office-${id}.glb`;

// ---------- manifest (finite, primary-authored, pinned) ----------
const manifestBuf = fs.readFileSync(MANIFEST);
if (sha(manifestBuf) !== MANIFEST_SHA) throw new Error(`manifest sha256 changed (${sha(manifestBuf)}); refusing to build`);
const MANIFEST_JSON = JSON.parse(manifestBuf.toString());
const ASSETS = MANIFEST_JSON.assets;
if (ASSETS.length !== 58) throw new Error('expected 58 manifest assets');
const MY_PATHS = new Set([...ASSETS.map(a => outRelOf(a.id)), PROV_REL]);

// Texture policy (iteration-16 style): [baseColor px, other maps px, jpeg quality] ladders; budgets in bytes.
const isLarge = a => a.sizeM >= 1.5;
const LADDER_LARGE = [[1024, 512, 85], [1024, 512, 80], [1024, 512, 72], [768, 512, 80], [512, 512, 80], [512, 512, 72]];
const LADDER_SMALL = [[512, 512, 85], [512, 512, 80], [512, 512, 72], [512, 256, 72]];
const BUDGET = a => (isLarge(a) ? 600_000 : 400_000);

// Per-asset observations from the CPU-rendered QA views, for integrators (filled after inspection; mirrored in DELIVERED.json).
const NOTES = {
  'gumball-jar': 'tipped jar with gumballs spilled around the base: footprint ~1.03 x 0.66 m at 0.75 m tall',
  'console-station': 'TV on a low media stand (top ~0.93 m); console, controllers and open shelf on the -Z side',
  'law-bookcase': 'wide, deep bookcase (~1.13 x 2.2 x 0.67 m)',
  'trading-desk': 'curved desk: monitors on the outer arc, operator side (concave) toward -Z',
  'bull-statue': 'length along Z, head toward -Z',
  'lab-bench': 'replacement attempt 2 (attempt 1 was the wrong object)',
  'architect-model': 'presentation table with tall white towers (~1.6 x 1.61 x 1.46 m)',
  'tv-camera': 'native lens pointed -X; turned -90 deg so the lens faces -Z (~0.85 x 1.7 x 1.40 m)',
  'news-desk': 'ring-shaped anchor desk with a tall backdrop panel on +Z (~2.6 x 1.24 x 1.77 m)',
  'espresso-machine': 'freestanding all-in-one machine, no separate cart (~1.4 x 1.29 x 1.41 m, deep)',
  'coffee-roaster': 'large (~2.43 x 1.8 x 1.58 m); drum door and cooling tray at the -X end',
  'treadmill': 'console at the +Z end, deck toward -Z (~1.19 x 1.85 x 2.0 m)',
  'sneaker-wall': 'wide (2.32 m) tall panel unit plus a lower side shelf unit',
  'rocking-horse': 'length along Z, head toward -Z',
  'mixing-console': 'deep desk (~2.0 x 1.25 x 1.99 m), monitor speakers at the back',
  'ship-model': 'glass display case only, no cabinet: low (~0.59 m) - stand it on a sideboard/table',
  'parcel-pallet': 'bulky 2x2x2 parcel stack on a pallet (~1.2 x 1.3 x 1.44 m)',
  'nap-pod': 'dome pod (~1.8 x 1.27 x 1.63 m), opening toward -Z',
  'kegerator': 'bulky (~1.32 x 1.4 x 1.37 m); the refine texture painted a poster-like portrait of an elderly man on the -X side panel (texture hallucination; flagged for the primary)',
  'metal-detector': 'wide walk-through portal (~3.12 x 2.2 x 1.99 m); walk-through axis Z',
  'vault-safe': 'bulky (~1.31 x 1.5 x 1.35 m); dial door -Z',
  'aquarium': 'tank only, no cabinet (~1.5 x 0.64 x 0.70 m) - stand it on a sideboard/counter',
  'bakery-case': 'curved customer glass faces -Z (native, no rotation); open server side +Z',
  'satellite-model': 'solar wings span X (1.8 m); ~0.9 m tall on its stand',
  'telescope': 'aperture points +Z (toward the wall/window), eyepiece/handles face -Z',
  'executive-desk': 'front -Z = visitor/modesty side (native, no rotation); drawer/seat side +Z: put the executive chair on +Z facing -Z',
  'server-cabinet': 'wide three-bay cabinet (~2.92 x 2.0 x 1.38 m), glass server bay in the middle',
  'security-turnstile': 'replacement attempt 2; two pedestals spread along X (1.59 m) with glass flaps across one lane; walk-through axis Z',
  'foosball-table': 'rod handles stick out on both long sides (1.4 x 0.52 x 1.26 m incl. rods)',
  'ping-pong-table': 'squat table (~2.42 x 0.83 x 2.74 m); net across X at mid-length',
  'rooftop-hvac': '~2.13 x 2.32 x 2.4 m; fan grilles on -Z and both X sides, plain back +Z',
  'water-tower': 'tank sits low, no tall steel stand (~4.59 x 4.5 x 4.58 m); ladder on -Z',
  'satellite-dish': 'dish faces -Z (native, no rotation)',
  'toilet': 'tank at +Z (against the wall), bowl and open seat toward -Z',
};

// ---------- lane FURN (office-props-physics-scale-20261030): furniture-only real size + separated loose clutter ----------
// Measured in the MANIFEST frame (the previous runtime GLB: front -Z, grounded, centred) with CPU ortho renders, component lists and
// side profiles (reference/tasks/office-props-physics-scale-20261030/evidence/FURN). `clutter(c)`: the component is a loose object
// standing on the furniture (bbox c.min / c.max / c.centre, metres). `parts`: one representative per object type (selection box around
// its components' bbox centres) and its OWN real size (sizeM along sizeAxis h / w / d / longest); `item: true` = an item pickup model.
// Zombie-beside checks (tools/asset-pipeline/props/scale-check.mjs) of every result are in the evidence folder.
const ext = c => [0, 1, 2].map(k => c.max[k] - c.min[k]);
const FURNITURE = {
  // D09: worktop top 0.538 m in the manifest frame (a miniature: the manifest sized it by its 1.8 m width) -> 0.9 m, the standard
  // standing lab-bench height. Everything resting on the worktop is loose clutter (microscope, flasks, bottle stands, tube rack,
  // a ring stand, petri dishes, tubing); the bench carcass, top and drawers are the body.
  'lab-bench': {sizeM: 0.9, sizeAxis: 'h', basis: 'worktop height (standard standing lab bench 0.90 m); body only — loose glassware / equipment removed',
    clutter: c => c.min[1] >= 0.535,
    supports: [{y: 0.5485, tol: 0.004}], // the worktop's top face (painted ghosts of the glassware cleaned)
    parts: {
      'lab-flask': {box: [-0.42, 0.53, 0.1, -0.34, 0.7, 0.18], sizeM: 0.18, sizeAxis: 'h', label: '500 ml Erlenmeyer flask'},
      'lab-flask-large': {box: [0.68, 0.53, 0.11, 0.83, 0.8, 0.26], sizeM: 0.3, sizeAxis: 'h', label: '2 l Erlenmeyer flask of green culture'},
      'lab-microscope': {box: [0.49, 0.53, -0.05, 0.667, 0.95, 0.24], sizeM: 0.4, sizeAxis: 'h', label: 'compound microscope',
        skip: c => ext(c)[2] > 0.25 && ext(c)[1] < 0.03}, // the loose tube curling across the bench behind it
      'lab-bottle': {box: [0.15, 0.53, 0.08, 0.21, 0.69, 0.16], sizeM: 0.22, sizeAxis: 'h', label: '1 l reagent bottle'},
      'lab-bottle-rack': {box: [-0.19, 0.53, -0.02, 0.12, 0.87, 0.15], sizeM: 0.4, sizeAxis: 'h', label: 'wire stand of three reagent bottles'},
      'lab-tube-rack': {box: [-0.83, 0.53, -0.21, -0.58, 0.68, -0.05], sizeM: 0.26, sizeAxis: 'w', label: 'test-tube rack'},
    }},
  // D07: desk top 0.373 m (manifest frame) -> 0.74 m, a standard desk. On it: five monitors on stands, keyboard + mouse, a desk phone
  // with its coiled cord; two monitor necks are welded to cable bundles hanging over the desk's edge (they rise above the top too).
  // Body = curved top, legs, the PC tower on the floor under it, the under-desk cables.
  'trading-desk': {sizeM: 0.74, sizeAxis: 'h', basis: 'desk-top height 0.74 m (standard desk); body only — monitors, keyboard / mouse and phone removed',
    clutter: c => (c.min[1] >= 0.36 || c.max[1] > 0.385) && ext(c)[0] < 1.0,
    supports: [{y: 0.3725, tol: 0.004}], // the desk top (painted monitor feet / keyboard / phone ghosts cleaned)
    parts: {
      'trading-monitor': {box: [-0.21, 0.36, 0.22, 0.21, 0.7, 0.36], sizeM: 0.62, sizeAxis: 'w', label: '27-inch monitor on its stand'},
      'trading-keyboard': {box: [-0.27, 0.36, 0.0, 0.19, 0.42, 0.15], sizeM: 0.62, sizeAxis: 'w', label: 'keyboard and mouse'},
    }},
  // D38: 1.11 m overall at 1.6 m wide (a low, toy-like case: display deck 0.47 m) -> 1.35 m overall (deck ~0.57 m, shelves ~0.82 /
  // ~1.04 m). Loose clutter = the loaves, rolls, baskets and trays on the deck and both glass shelves; the case, its glass, the shelves
  // and their rails stay.
  'bakery-case': {sizeM: 1.35, sizeAxis: 'h', basis: 'overall height 1.35 m (refrigerated bakery display case; display deck ~0.57 m); body only — baked bread removed',
    clutter: c => c.min[1] >= 0.46 && c.max[1] <= 0.97 && Math.abs(c.centre[0]) < 0.7 && ext(c)[0] < 1.0,
    // the display deck and the two glass shelves (their texture had the loaves painted on / seen through them)
    supports: [{y: 0.477, tol: 0.007, x: [-0.76, 0.76]}, {y: 0.676, tol: 0.006}, {y: 0.852, tol: 0.007}],
    // the customer glass (curved front), the inner pane and the glazed top were PAINTED on the opaque shell: they become a real
    // transparent 'glass' node (the shop-cooler glass contract) so the loaves show from the customer side
    glass: {minY: 0.49, maxX: 0.76},
    parts: {
      'bread': {box: [-0.63, 0.84, 0.02, -0.37, 0.96, 0.32], sizeM: 0.26, sizeAxis: 'longest', longX: true, item: true, label: 'round crusty loaf'},
    }},
  // E12: 0.86 x 0.39 x 0.90 (knee-high on a standing zombie) -> 1.3 m across: an adult bean bag (the model is a squashed, sat-in bag:
  // ~0.56 m tall at that size).
  'bean-bag': {sizeM: 1.3, sizeAxis: 'longest', basis: '1.3 m across (adult bean bag; the squashed, sat-in shape is ~0.56 m tall)'},
};
const partUrl = (pid, p) => (p.item ? `assets/models/item-${pid}-t25.glb` : `assets/models/office-${pid}.glb`);
const PART_PATHS = Object.values(FURNITURE).flatMap(f => Object.entries(f.parts ?? {}).map(([pid, p]) => partUrl(pid, p)));
const PART_TEX_PX = 256, PART_TEX_Q = 85;
for (const p of PART_PATHS) MY_PATHS.add(p);
const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const ALLOW_OUT = argOf('--allowlist-out');
const NO_DELIVERED = process.argv.includes('--no-delivered');

// ---------- ledger ----------
const ledger =fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function jobsFor(a) {
  const ev = ledger.filter(e => e.code === a.code);
  const accepted = [...ev].reverse().find(e => e.event === 'inspect' && e.kind === 'refine' && e.verdict === 'accepted');
  const dl = accepted ? ev.find(e => e.event === 'download' && e.kind === 'refine' && e.task_id === accepted.task_id) : null;
  const refineAck = dl ? ev.find(e => e.event === 'ack' && e.kind === 'refine' && e.task_id === dl.task_id) : null;
  const previewId = refineAck?.preview_task_id ?? null;
  const previewDl = previewId ? ev.find(e => e.event === 'download' && e.kind === 'preview' && e.task_id === previewId) : null;
  const previewAck = previewId ? ev.find(e => e.event === 'ack' && e.kind === 'preview' && e.task_id === previewId) : null;
  const intentOf = ack => (ack ? ev.find(e => e.event === 'intent' && e.kind === ack.kind && e.t === ack.intentT)
    ?? [...ev].reverse().find(e => e.event === 'intent' && e.kind === ack.kind && e.t <= ack.t) : null);
  const previewIntent = intentOf(previewAck), refineIntent = intentOf(refineAck);
  const acks = ev.filter(e => e.event === 'ack');
  const rejects = ev.filter(e => e.event === 'reject');
  const failed = ev.filter(e => e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''));
  const credits = ev.filter(e => e.event === 'download' || (e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? '')))
    .reduce((acc, e) => { if (acc.seen.has(e.task_id)) return acc; acc.seen.add(e.task_id); acc[e.kind] += e.consumed_credits ?? 0; return acc; }, {preview: 0, refine: 0, seen: new Set()});
  return {ev, accepted, dl, refineAck, previewDl, previewAck, previewIntent, refineIntent, acks, rejects, failed,
    credits: {preview: credits.preview, refine: credits.refine, total: credits.preview + credits.refine}};
}

// ---------- models ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const prevProv = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : null;
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const ROT = {'+Z': Math.PI, '-Z': 0, '+X': Math.PI / 2, '-X': -Math.PI / 2};
const outputs = [], missing = [];

async function derive(a, rawBytes, front, [basePx, otherPx, quality]) {
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const th = ROT[front];
  const c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
  // rotated (axis-aligned, quarter-turn) extents: x' = c x + s z, z' = -s x + c z
  const e0 = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
  const ext = [Math.abs(c) * e0[0] + Math.abs(sn) * e0[2], e0[1], Math.abs(sn) * e0[0] + Math.abs(c) * e0[2]];
  const ref = a.sizeAxis === 'h' ? ext[1] : a.sizeAxis === 'w' ? ext[0] : Math.max(...ext);
  const s = a.sizeM / ref;
  // column-major: p' = s * rotY(th) * p
  const R = [s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, 0, 0, 0, 1];
  for (const m of r.listMeshes()) transformMesh(m, R);
  const b1 = getBounds(scene);
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1];
  for (const m of r.listMeshes()) transformMesh(m, T);
  // lane FURN (office-props-physics-scale-20261030): loose clutter separated in the manifest frame, then the FURNITURE-ONLY real size
  const F = FURNITURE[a.id];
  let k = 1, split = null, ghosts = null, glass = null;
  const parts = [];
  if (F) {
    if (F.parts) split = await splitClutter(doc, F);
    if (F.glass) glass = await splitGlass(doc, sharp, F.glass);
    if (F.supports) ghosts = await cleanSupportTexture(doc, sharp, F.supports, F.ghostThresh ?? 34, process.env.FURN_GHOST_DEBUG ? path.join(process.env.FURN_GHOST_DEBUG, `${a.id}-ghosts.png`) : null);
    const bb = getBounds(scene);
    k = F.sizeM / extentOf(bb, F.sizeAxis);
    scaleGroundCentre(doc, k);
    // where each extracted representative stood, in the runtime body frame (front -Z): k * p - the body's re-centring offset
    const off = [k * (bb.min[0] + bb.max[0]) / 2, k * bb.min[1], k * (bb.min[2] + bb.max[2]) / 2];
    for (const p of split?.parts ?? []) {
      const P = F.parts[p.id], name = P.item ? `item-${p.id}` : `office-${p.id}`;
      const pr = p.doc.getRoot();
      pr.listMeshes().forEach((m, i) => m.setName(i ? `${p.id}-${i}` : p.id));
      pr.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${p.id}-${i}` : p.id));
      pr.listMaterials().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
      const crop = await cropPartTextures(p.doc, sharp, PART_TEX_PX, PART_TEX_Q);
      pr.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-office-overhaul.mjs + lib/clutter-split.mjs (glTF-Transform)';
      const stood = {min: [0, 1, 2].map(q => +(k * p.before.min[q] - off[q]).toFixed(4)), max: [0, 1, 2].map(q => +(k * p.before.max[q] - off[q]).toFixed(4))};
      parts.push({id: p.id, glb: Buffer.from(await io.writeBinary(p.doc)), tris: p.tris, scale: s * p.scale, manifestFrame: p.before, stood, crop});
    }
  }
  // (lane FURN: a separated transparent 'glass' node keeps its names — damage/materials.ts partKeyClass reads /glass/)
  r.listMeshes().filter(m => !/glass/.test(m.getName())).forEach((m, i) => m.setName(i ? `${a.id}-${i}` : a.id));
  r.listNodes().filter(n => n.getMesh() && n.getName() !== 'glass').forEach((n, i) => n.setName(i ? `${a.id}-${i}` : a.id));
  r.listMaterials().filter(m => !/-glass$/.test(m.getName())).forEach((m, i) => m.setName(i ? `office-${a.id}-${i}` : `office-${a.id}`));
  for (const m of r.listMaterials().filter(q => /-glass$/.test(q.getName()))) m.setName(`office-${a.id}-glass`);
  for (const m of r.listMeshes().filter(q => /glass/.test(q.getName()))) m.setName(`${a.id}-glass`);
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [basePx, basePx], quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [otherPx, otherPx], quality, slots: /^(?!baseColor)/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-office-overhaul.mjs (glTF-Transform)';
  return {glb: Buffer.from(await io.writeBinary(doc)), scale: s * k, rawExtent: e0, parts,
    furniture: F ? {k, removed: split?.removed ?? null, ghosts, glass} : null};
}

for (const a of ASSETS) {
  const j = jobsFor(a);
  if (!j.dl) {
    const failedNow = j.failed.length && !j.acks.some(x => x.kind === 'refine');
    missing.push({id: a.id, code: a.code, reason: failedNow ? `generation failed (${j.failed.map(f => f.status).join(', ')})`
      : j.acks.some(x => x.kind === 'refine') ? 'refine submitted, not accepted/delivered yet' : j.acks.some(x => x.kind === 'preview') ? 'preview only' : 'not generated'});
    continue;
  }
  const rawPath = path.join(ASSETS_DIR, j.dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== j.dl.sha256) throw new Error(`raw sha mismatch for ${a.id}: ${j.dl.file}`);
  const outRel = outRelOf(a.id);
  const outAbs = path.join(root, 'game/public', outRel);
  const front = j.accepted.front ?? '+Z';
  if (!(front in ROT)) throw new Error(`${a.id}: bad front ${front}`);
  // collision guard: never overwrite a public model this task did not create
  const prevMine = prevProv?.outputs?.some(o => o.output.url === outRel);
  if (fs.existsSync(outAbs) && allow.files.some(f => f.path === outRel) && !prevMine) throw new Error(`${outRel} exists and is not this task's file`);

  let glb, scale, rawExtent, step = 0, parts = [], furniture = null;
  const ladder = isLarge(a) ? LADDER_LARGE : LADDER_SMALL;
  const F = FURNITURE[a.id];
  const reuse = ONLY && !ONLY.has(a.code) && fs.existsSync(outAbs) && prevProv?.outputs?.find(o => o.id === a.id && o.source.sha256 === j.dl.sha256 && o.output.sha256 === sha(fs.readFileSync(outAbs))
    && (o.parts ?? []).every(q => fs.existsSync(path.join(root, 'game/public', q.output.url)) && q.output.sha256 === sha(fs.readFileSync(path.join(root, 'game/public', q.output.url)))));
  if (reuse) {
    glb = fs.readFileSync(outAbs); scale = reuse.scale; rawExtent = reuse.source.extent; step = reuse.textureStep;
    // lane FURN: separated parts of a reused derivative are reused with it (same raw, same files)
    parts = (reuse.parts ?? []).map(q => ({id: q.id, glb: fs.readFileSync(path.join(root, 'game/public', q.output.url)), tris: q.output.triangles, scale: q.scale, manifestFrame: q.manifestFrame, stood: q.stood, crop: q.textureCrop}));
    furniture = reuse.furniture ? {k: reuse.furniture.scaleFromManifest, removed: reuse.furniture.removed, ghosts: reuse.furniture.supportTextureCleanup ?? null, glass: reuse.furniture.glass ?? null} : null;
  } else {
    for (step = 0; step < ladder.length; step++) {
      ({glb, scale, rawExtent, parts, furniture} = await derive(a, rawBytes, front, ladder[step]));
      if (glb.length <= BUDGET(a)) break;
    }
    if (step === ladder.length) step = ladder.length - 1;
    for (const buf of [glb, ...parts.map(q => q.glb)]) {
      const jsonChunk = buf.subarray(20, 20 + buf.readUInt32LE(12)).toString();
      if (/https?:|Signature=|X-Amz|Key-Pair-Id|token=/i.test(jsonChunk)) throw new Error(`URL/token-like string inside ${a.id} glTF JSON`);
    }
    fs.writeFileSync(outAbs, glb);
    // lane FURN: the separated parts (collision guard: never overwrite a public model this pipeline did not create)
    for (const q of parts) {
      const rel = partUrl(q.id, F.parts[q.id]), abs = path.join(root, 'game/public', rel);
      const mine = prevProv?.outputs?.some(o => (o.parts ?? []).some(x => x.output.url === rel));
      if (fs.existsSync(abs) && allow.files.some(f => f.path === rel) && !mine) throw new Error(`${rel} exists and is not this pipeline's file`);
      fs.writeFileSync(abs, q.glb);
    }
  }
  // lane FURN: re-measure the separated parts as written
  const partOut = [];
  for (const q of parts) {
    const P = F.parts[q.id], rel = partUrl(q.id, P);
    const pd = await io.readBinary(new Uint8Array(q.glb));
    const pb = getBounds(pd.getRoot().getDefaultScene() ?? pd.getRoot().listScenes()[0]);
    const pdims = [0, 1, 2].map(kk => +(pb.max[kk] - pb.min[kk]).toFixed(4));
    if (Math.abs(pb.min[1]) > 1e-4 || Math.abs(pb.min[0] + pb.max[0]) > 2e-3 || Math.abs(pb.min[2] + pb.max[2]) > 2e-3) throw new Error(`${q.id} not grounded/centred`);
    if (Math.abs(extentOf(pb, P.sizeAxis) - P.sizeM) > 2e-3) throw new Error(`${q.id} not at its real size`);
    const ptris = pd.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);
    partOut.push({id: q.id, label: P.label, kind: P.item ? 'item' : 'prop', sizeM: P.sizeM, sizeAxis: P.sizeAxis, scale: +q.scale.toFixed(6),
      selection: P.box, manifestFrame: q.manifestFrame, stood: q.stood, textureCrop: q.crop,
      output: {file: `game/public/${rel}`, url: rel, sha256: sha(q.glb), bytes: q.glb.length, triangles: ptris, dims: pdims},
      textures: pd.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}))});
  }
  // re-measure the written file
  const chk = await io.readBinary(new Uint8Array(glb));
  const b = getBounds(chk.getRoot().getDefaultScene() ?? chk.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(k => +(b.max[k] - b.min[k]).toFixed(4));
  const tris = chk.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 * a.sizeM || Math.abs(b.min[2] + b.max[2]) > 1e-3 * a.sizeM) throw new Error(`${a.id} not grounded/centred`);
  const textures = chk.getRoot().listTextures().map(t => {
    const slot = chk.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  const rawDoc = await io.readBinary(new Uint8Array(rawBytes));
  const rawTex = rawDoc.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  const rawTris = rawDoc.getRoot().listMeshes().reduce((s2, m) => s2 + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const overBudget = glb.length > BUDGET(a);
  const attempts = j.acks.map(x => ({kind: x.kind, task: x.task_id, ...(j.rejects.find(r => r.task_id === x.task_id) ? {rejected: j.rejects.find(r => r.task_id === x.task_id).reason} : {}),
    ...(j.failed.find(f => f.task_id === x.task_id) ? {status: j.failed.find(f => f.task_id === x.task_id).status} : {})}));
  outputs.push({code: a.code, id: a.id, key: `office-${a.id}`, company: a.company, use: a.use, placement: a.placement, subject: a.subject,
    ...(a.justification ? {justification: a.justification, feedbackItem: a.feedbackItem} : {}),
    model: 'meshy-t2.5', modelType: 'smart-topology', topology: 'triangle', route: 'text-to-3d preview (geometry) + refine (2K PBR texture, inherits the preview model)',
    previewPrompt: j.previewIntent?.args.prompt ?? a.preview.prompt, texturePrompt: j.refineIntent?.args.texture_prompt ?? a.refine.texture_prompt,
    previewArgs: j.previewIntent ? (({prompt: _p, response_format: _r, ...rest}) => rest)(j.previewIntent.args) : null,
    refineArgs: j.refineIntent ? (({texture_prompt: _t, preview_task_id: _i, response_format: _r, ...rest}) => ({...rest, ai_model: 'omitted (inherits the T2.5 preview)'}))(j.refineIntent.args) : null,
    tasks: {preview: j.refineAck.preview_task_id, refine: j.dl.task_id},
    credits: {preview: j.previewDl?.consumed_credits ?? null, refine: j.dl.consumed_credits ?? null},
    creditsAllAttempts: j.credits.total, attempts,
    source: {file: `${TASK_DIR}/assets/${j.dl.file} (raw original, outside Git)`, sha256: j.dl.sha256, bytes: j.dl.bytes, triangles: rawTris, extent: rawExtent.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: j.previewDl ? `${TASK_DIR}/assets/${j.previewDl.file}` : null, previewSha256: j.previewDl?.sha256 ?? null, previewTriangles: j.previewDl?.glb?.tris ?? null},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: tris, dims, overBudget},
    targetTriangles: a.tris, sizeM: F?.sizeM ?? a.sizeM, sizeAxis: F?.sizeAxis ?? a.sizeAxis, scale: +scale.toFixed(6), nativeFront: front, textureStep: step,
    textureSizes: {baseColor: ladder[step][0], other: ladder[step][1], jpegQuality: ladder[step][2]},
    transform: `rotateY(${({'+Z': '180', '-Z': '0', '+X': '90', '-X': '-90'})[front]}deg) * uniform scale, then grounded (min y = 0) and centred on x/z; baked into vertices${F ? `; lane FURN: ${F.parts ? 'loose clutter separated, then ' : ''}furniture-only rescale x${furniture.k.toFixed(4)} to ${F.sizeM} m (${F.sizeAxis}), grounded / centred again` : ''}`, front: '-Z', up: '+Y',
    review: {evidence: j.accepted.evidence ?? null, checks: j.accepted.checks ?? null, observation: j.accepted.observation ?? null},
    ...(NOTES[a.id] ? {note: NOTES[a.id]} : {}), textures,
    // lane FURN (office-props-physics-scale-20261030): furniture-only real size + the separated loose clutter (local operation on this raw)
    ...(F ? {furniture: {task: 'office-props-physics-scale-20261030 (lane FURN)', operation: F.parts ? 'local separation of baked loose clutter (connected components on the worktop / desk top / display shelves) + furniture-only rescale' : 'furniture-only rescale',
      manifestSizeM: a.sizeM, manifestSizeAxis: a.sizeAxis, sizeM: F.sizeM, sizeAxis: F.sizeAxis, basis: F.basis, scaleFromManifest: +furniture.k.toFixed(6), removed: furniture.removed,
      ...(furniture.ghosts ? {supportTextureCleanup: furniture.ghosts, supportHeights: F.supports.map(q => q.y)} : {}),
      ...(furniture.glass ? {glass: {...furniture.glass, node: 'glass', selection: F.glass, material: {...GLASS_MATERIAL, alphaMode: 'BLEND', doubleSided: true, textured: false},
        contract: 'the shop-cooler glass fix (task model-touchups-20261030, lane GLASS): transparent, depthWrite false, never a flashlight-shadow caster'}} : {})},
      ...(partOut.length ? {parts: partOut} : {})} : {})});
  console.log(`${a.code} ${a.id}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e3).toFixed(0)} kB (tex step ${step}), dims ${dims.join(' x ')}${overBudget ? '  OVER BUDGET' : ''}${reuse ? ' (reused)' : ''}`);
  for (const q of partOut) console.log(`    part ${q.id}: ${q.output.triangles} tris, ${(q.output.bytes / 1e3).toFixed(0)} kB, dims ${q.output.dims.join(' x ')}, stood at x ${q.stood.min[0]}..${q.stood.max[0]} y ${q.stood.min[1]} z ${q.stood.min[2]}..${q.stood.max[2]}`);
}

// ---------- credits summary (whole run, from the ledger) ----------
const billed = new Map();
for (const e of ledger) if ((e.event === 'download' || e.event === 'status') && e.task_id && typeof e.consumed_credits === 'number') billed.set(e.task_id, {kind: e.kind, credits: e.consumed_credits, code: e.code});
const rejectedTasks = new Set(ledger.filter(e => e.event === 'reject').map(e => e.task_id));
const creditSummary = {previews: 0, refines: 0, rejectedOrReplacedAttempts: 0, total: 0};
for (const [tid, v] of billed) { creditSummary[v.kind === 'preview' ? 'previews' : 'refines'] += v.credits; if (rejectedTasks.has(tid)) creditSummary.rejectedOrReplacedAttempts += v.credits; creditSummary.total += v.credits; }
const replacements = ledger.filter(e => e.event === 'intent' && e.replacement).map(e => ({code: e.code, kind: e.kind, reason: e.replacement}));

// ---------- provenance ----------
const mcpDir = (() => {
  const base = path.join(process.env.HOME ?? '/home/node', '.npm/_npx');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).sort()) { const p = path.join(base, d, 'node_modules/@meshy-ai/meshy-mcp-server'); if (fs.existsSync(path.join(p, 'dist/tools/generation.js'))) return p; }
  return null;
})();
const mcpSha = mcpDir ? {version: JSON.parse(fs.readFileSync(path.join(mcpDir, 'package.json'), 'utf8')).version,
  'dist/tools/generation.js': sha(fs.readFileSync(path.join(mcpDir, 'dist/tools/generation.js'))),
  'dist/utils/generation-options.js': fs.existsSync(path.join(mcpDir, 'dist/utils/generation-options.js')) ? sha(fs.readFileSync(path.join(mcpDir, 'dist/utils/generation-options.js'))) : null} : (prevProv?.modelProof?.mcpSource ?? null);
const prov = {schema: 'last-line-derivative/1', asset: 'office-overhaul-20261030', task: TASK, lane: 'ASSETS (Studio Beta office overhaul)',
  status: 'runtime derivatives of models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP under the user\'s explicit authorization for this brief (40 company props + justified supporting office models, finite manifest, run cap 960 credits); provider terms apply; unapproved prototypes, no licence or commercial clearance implied',
  rebuild: 'node tools/asset-pipeline/props/build-office-overhaul.mjs',
  rawStorage: `${TASK_DIR}/assets/raw/<id>/{preview,refine}/ (immutable native GLBs, task status JSON, thumbnails) + ${TASK_DIR}/assets/ledger.jsonl (fsynced intent/ack/status/download/inspect records) + manifest.json (sha256 ${MANIFEST_SHA}); outside Git`,
  convention: 'metres at real size (sizeM along sizeAxis), +Y up, front -Z, grounded (min y = 0), centred on x/z; native front (normally +Z) turned to -Z about Y',
  texturePolicy: 'native 2K PBR maps (base colour, metallic-roughness, normal) kept per channel, downsized with sharp Lanczos to JPEG: base colour 1024 for pieces >= 1.5 m nominal else 512, other maps 512, q85; deterministic step-down ladder to stay under 600 kB (large) / 400 kB (small)',
  modelProof: {
    requested: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', topology: 'triangle', target_formats: ['glb'], refine: 'texture_resolution 2k, enable_pbr true, ai_model omitted (inherits the preview model)'},
    evidence: [
      'exact create arguments (verbatim from the pinned manifest) recorded in the fsynced ledger (intent line) before every paid call; ack with the returned task id right after',
      'every preview billed 5 credits (the T2 / T2.5 / 6-lite tier; meshy-6, meshy-7.1 and latest bill 20) and every refine 10 (2K texture)',
      'every preview returned a triangle-only mesh near target_polycount (smart-topology behaviour), kept unchanged by its refine',
      'the Meshy task GET response surfaced by the MCP does not echo ai_model / model_type, so the request record is the model proof'],
    mcpSource: mcpSha},
  manifest: {assets: ASSETS.length, company: ASSETS.filter(a => a.use === 'company').length, support: ASSETS.filter(a => a.use === 'support').length,
    manifestCredits: MANIFEST_JSON.manifestCredits, maxReplacements: MANIFEST_JSON.maxReplacements, runCap: MANIFEST_JSON.runCapCredits, sha256: MANIFEST_SHA},
  credits: creditSummary, replacements,
  outputs, missing};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i);
  if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }
const newFiles = outputs.flatMap(o => [o.output.url, ...(o.parts ?? []).map(q => q.output.url)]).map(u => ({path: u, buf: fs.readFileSync(path.join(root, 'game/public', u))}));
if (outputs.length) { fs.writeFileSync(PROV, provBuf); newFiles.push({path: PROV_REL, buf: provBuf}); }

// ---------- allowlist (only this task's paths; CREDITS.md entry refreshed only when it carries this task's section) ----------
const kept = allow.files.filter(f => !MY_PATHS.has(f.path));
const added = newFiles.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}));
for (const f of allow.files.filter(f => MY_PATHS.has(f.path) && !added.some(x => x.path === f.path))) console.warn('allowlist: dropping stale', f.path);
allow.files = [...kept, ...added].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
const credBuf = fs.readFileSync(CREDITS);
if (credBuf.toString().includes(CREDITS_MARK)) {
  const ce = allow.files.find(f => f.path === CREDITS_REL);
  if (ce && (ce.sha256 !== sha(credBuf) || ce.bytes !== credBuf.length)) { ce.bytes = credBuf.length; ce.sha256 = sha(credBuf); console.log('allowlist: refreshed assets/CREDITS.md (carries this task\'s credits section)'); }
}
// lane FURN: --allowlist-out writes this task's entries elsewhere (the integrating primary regenerates tools/release/public-inputs.json)
if (ALLOW_OUT) fs.writeFileSync(ALLOW_OUT, JSON.stringify({note: 'entries build-office-overhaul.mjs owns (tools/release/public-inputs.json files[]); stale ones dropped', owned: [...MY_PATHS].sort(), files: allow.files.filter(f => MY_PATHS.has(f.path) || f.path === CREDITS_REL)}, null, 2) + '\n');
else fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');

// ---------- registry (GENERATED blocks of companyAssets.ts / companyDims.generated.ts) ----------
const q = v => (v === null ? 'null' : `'${v}'`);
const arr = v => `[${v.join(', ')}]`;
const assetLines = ASSETS.map(a => {
  const o = outputs.find(x => x.id === a.id);
  const F = FURNITURE[a.id]; // lane FURN: the furniture-only size
  return `  '${a.id}': {url: ${o ? q(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, tris: ${o ? o.output.triangles : 0}, sizeM: ${F?.sizeM ?? a.sizeM}, sizeAxis: '${F?.sizeAxis ?? a.sizeAxis}', code: '${a.code}', company: ${q(a.company)}, use: '${a.use}', placement: '${a.placement}', targetTris: ${a.tris}, dims: ${o ? arr(o.output.dims) : 'null'}},`;
});
// lane FURN: the loose clutter separated from the furniture (props) and the bread loaf (item model)
const partList = outputs.flatMap(o => (o.parts ?? []).map(qq => ({...qq, from: o.id})));
const partLines = partList.map(qq => `  '${qq.id}': {url: ${q(qq.output.url)}, bytes: ${qq.output.bytes}, tris: ${qq.output.triangles}, from: '${qq.from}', kind: '${qq.kind}', sizeM: ${qq.sizeM}, sizeAxis: '${qq.sizeAxis}', dims: ${arr(qq.output.dims)}},`);
const block1 = ['// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers',
  'export const COMPANY_ASSETS: Record<CompanyAssetId, CompanyAssetEntry> = {', ...assetLines, '};', '',
  'export const COMPANY_PART_ASSETS: Readonly<Record<string, CompanyPartEntry>> = {', ...partLines, '};', '// END GENERATED'].join('\n');
const block2 = ['// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers',
  'export const COMPANY_DIMS: Record<string, readonly [number, number, number] | null> = {',
  ...ASSETS.map(a => { const o = outputs.find(x => x.id === a.id); return `  '${a.id}': ${o ? arr(o.output.dims) : 'null'},`; }), '};', '',
  'export const COMPANY_ASSET_SPECS: Record<string, CompanyAssetSpec> = {',
  ...ASSETS.map(a => `  '${a.id}': {code: '${a.code}', company: ${q(a.company)}, use: '${a.use}', sizeM: ${FURNITURE[a.id]?.sizeM ?? a.sizeM}, sizeAxis: '${FURNITURE[a.id]?.sizeAxis ?? a.sizeAxis}', placement: '${a.placement}'},`),
  '};', '',
  '/** Lane FURN (office-props-physics-scale-20261030): measured runtime bounds [x, y, z] of the loose clutter separated from the furniture. */',
  'export const COMPANY_PART_DIMS: Readonly<Record<string, readonly [number, number, number]>> = {',
  ...partList.map(qq => `  '${qq.id}': ${arr(qq.output.dims)},`), '};', '// END GENERATED'].join('\n');
const re = /\/\/ BEGIN GENERATED[^\n]*\n[\s\S]*?\/\/ END GENERATED/;
for (const [f, blk] of [[REGISTRY, block1], [DIMS_TS, block2]]) {
  const src = fs.readFileSync(f, 'utf8');
  if (!re.test(src)) throw new Error(`GENERATED markers missing in ${f}`);
  const next = src.replace(re, blk);
  if (next !== src) fs.writeFileSync(f, next);
}

// ---------- delivery note (atomic) ----------
const delivered = {task: TASK, generatedBy: 'tools/asset-pipeline/props/build-office-overhaul.mjs', credits: creditSummary, replacements, assets: {}};
for (const a of ASSETS) {
  const o = outputs.find(x => x.id === a.id), m = missing.find(x => x.id === a.id), j = jobsFor(a);
  const nominalOther = o ? (() => { const d = o.output.dims; return {x: d[0], y: d[1], z: d[2]}; })() : null;
  delivered.assets[a.id] = {code: a.code, id: a.id, key: `office-${a.id}`, company: a.company, use: a.use, placement: a.placement,
    status: o ? 'ready' : /failed/.test(m?.reason ?? '') ? 'failed' : 'missing',
    url: o ? o.output.url : null, sizeM: a.sizeM, sizeAxis: a.sizeAxis, dims: o ? o.output.dims : null, measured: nominalOther,
    tris: o ? o.output.triangles : 0, bytes: o ? o.output.bytes : 0,
    tasks: j.acks.map(x => ({kind: x.kind, task_id: x.task_id, ...(j.rejects.some(r => r.task_id === x.task_id) ? {rejected: true} : {})})),
    credits: j.credits.total,
    files: o ? {raw: o.source.file.replace(/ \(raw.*$/, ''), rawSha256: o.source.sha256, preview: o.source.previewFile, previewSha256: o.source.previewSha256,
      runtime: o.output.file, runtimeSha256: o.output.sha256} : null,
    nativeFront: o ? o.nativeFront : null,
    note: o ? `front -Z, grounded, centred${o.note ? `; ${o.note}` : ''}${o.output.overBudget ? '; OVER byte budget' : ''}` : m.reason};
}
if (!NO_DELIVERED) { // lane FURN: --no-delivered keeps the original task's delivery note untouched
  const tmp = `${DELIVERED}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(delivered, null, 1) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, DELIVERED);
}
const totalBytes = outputs.reduce((s2, o) => s2 + o.output.bytes, 0);
console.log(`models ready ${outputs.length}/${ASSETS.length} (${(totalBytes / 1e6).toFixed(2)} MB runtime); credits ${JSON.stringify(creditSummary)}; wrote ${outputs.length ? path.relative(root, PROV) + ', ' : ''}allowlist (${added.length} own entries), registry + dims, DELIVERED.json`);
