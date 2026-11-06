// Task studio-skyways-destinations-20261106-170011-01 (lane KITS): the runtime derivatives of the Skyways DESTINATION kit — the 46 Meshy
// T2.5 pieces (6 landmark heroes, shop fixtures and small loose items) of gen/assets.json. Route: Codex native image_gen INITIAL concept
// image -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); the model KEEPS Meshy's own PBR maps (base colour, metallic-roughness,
// normal), re-encoded / downsized only — never a Codex re-texture, projection or hand-painted replacement.
//
// Reads (never modifies) the lead's private task records OUTSIDE Git (reference/tasks/skyways-destinations-20261106-170011/):
//   USER-GENERATION-APPROVAL.json   (its sha256 must match FINANCIAL-ACK.json and the ledger's open line)
//   gen/FINANCIAL-ACK.json          the Meshy tool / settings acknowledgement
//   gen/assets.json                 the 46 pieces (id, real size axis / metres, triangle budget, tier) — checked against ROWS below
//   gen/LEDGER.jsonl                fsynced intent / posted / status / raw / accept / reject lines (+ the Codex concept intent / result)
//   gen/raw/meshy-<id>-<taskId>.glb the immutable raw originals (read-only; sha256 / bytes checked against the ledger raw line)
// and writes deterministically:
//   game/public/assets/models/skyways-d-<id>.glb               plain glTF binary (no Draco / meshopt / KTX2): one node / mesh / primitive / material
//   game/public/assets/derivatives/skyways-d-<id>-model.json   provenance (Meshy task id, ledger lines, input / raw sha256; no URLs / tokens)
//   game/src/assets/skywaysDestProps.generated.ts              SKYWAYS_DEST_PROPS (all 46 keys; unbuilt rows keep the planned sizes, planned: true)
//   tools/release/public-inputs.json                           ONLY this script's entries added / updated (others untouched)
//
// Per piece: exact-attribute weld (+ degenerate triangles dropped; lossless); meshoptimizer seam-preserving simplification ONLY where the
// raw is over the piece's budget (source UVs / normals kept; if the UV seams stall the collapse above the budget, or the result is
// visibly crumpled, the source mesh is kept — recorded); an optional quarter turn about Y (front +Z; `l` pieces long along X); UNIFORM
// scale so the piece's size axis is its real size (h = height, w / l = x extent, d = z extent); grounded (min y = 0) and centred on x / z,
// baked into the vertices (identity node). Maps by tier [base, metallicRoughness, normal] px: hero 2048 / 1024 / 1024, fixture
// 1024 / 512 / 512, small 512 / 512 / 512. Measured on the shipped mesh for the dressers: topY (table / bench / bin / board top),
// shelfY (the shelves' top faces), tierY / tierR (a tiered table's tier tops and radii), seatY (the seat top), hangY (the hanging point).
//
// A piece is built when its ledger has an `accept` line (the raw it names, else the latest raw before it) and no later `reject`; with
// --include-pending also when the latest raw is not yet accepted / rejected (the provenance then says accepted: false). A piece is never
// built before its row's `front` has been reviewed on the acceptance renders (lane KITS: ACCEPT-<batch>.md).
//
//   node tools/asset-pipeline/props/build-skyways-dest-props.mjs [--reference <dir>] [--include-pending] [--only id,id] [--dry-run <dir>]
//   (--reference = the dir holding tasks/skyways-destinations-20261106-170011; default: the first reference/ found from the repo upwards;
//    --only builds just those ids (the registry / allowlist are then NOT written; use with --dry-run); --dry-run writes GLBs only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '../../..');
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const TASK = 'studio-skyways-destinations-20261106-170011-01';
const TASK_REL = 'tasks/skyways-destinations-20261106-170011';
const TASK_DIR = `reference/${TASK_REL}`;
const findRef = () => { for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, 'reference', TASK_REL))) return path.join(d, 'reference'); if (d === path.dirname(d)) return path.join(root, 'reference'); } };
const REF = path.resolve(arg('--reference') ?? findRef());
const TDIR = path.join(REF, TASK_REL), GEN = path.join(TDIR, 'gen');
const DRY = arg('--dry-run'), ONLY = arg('--only')?.split(','), PENDING = process.argv.includes('--include-pending');
if (ONLY && !DRY) throw new Error('--only needs --dry-run (a partial build never rewrites the registry / allowlist)');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/skywaysDestProps.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/props/build-skyways-dest-props.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4), r6 = v => +v.toFixed(6);
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Map sizes [base colour, metallicRoughness, normal] px by tier (the brief). */
const TEX = {hero: [2048, 1024, 1024], fixture: [1024, 512, 512], small: [512, 512, 512]};

/**
 * The 46 pieces (gen/assets.json: n, id, size axis / metres, triangle budget, tier — checked at build time) + the lead's planned
 * placeholder bounds [w, h, d] (kept for unbuilt rows) + what the acceptance review decided: `turn` (degrees about +Y applied to the
 * raw before the fit; + = counter-clockwise seen from above), `front` (the reviewed front +Z convention; null = not reviewed yet: never
 * built), `measure` (the registry extras), `role`.
 */
const ROWS = [
  {n: 301, id: 'lm-clock', axis: 'h', m: 5.6, tris: 30000, tier: 'hero', planned: [1.6, 5.6, 1.6], role: 'Clock Court landmark: cast-iron clock tower on a stone plinth',
    front: 'front +Z = the main dial (dials also on the back and right sides)'},
  {n: 302, id: 'lm-dino', axis: 'l', m: 7.5, tris: 30000, tier: 'hero', planned: [7.5, 3.6, 2.4], turn: -90, role: 'Badlands Court landmark: hadrosaur skeleton cast on its display plinth',
    front: 'turned -90 deg about Y (Meshy delivered the long axis along Z, head at +Z): long axis X, HEAD at -X, the concept side elevation faces +Z'},
  {n: 303, id: 'lm-tree', axis: 'h', m: 7.0, tris: 30000, tier: 'hero', planned: [5.6, 7.0, 5.6], role: 'Fig Tree Court landmark: indoor fig in a raised round planter with a slatted ring bench',
    front: 'front +Z = the concept view (round planter and ring bench, the same all round)'},
  {n: 304, id: 'lm-fountain', axis: 'w', m: 5.2, tris: 30000, tier: 'hero', planned: [5.2, 2.6, 5.2], role: 'Fountain Court landmark: dry three-tier stone fountain in a round basin',
    front: 'front +Z = the concept view (round, the same all round)'},
  {n: 305, id: 'lm-geese', axis: 'w', m: 7.0, tris: 30000, tier: 'hero', planned: [7.0, 3.0, 4.0], measure: ['hangY'], role: 'Flight Court landmark: suspended bronze flock of Canada geese',
    front: null},
  {n: 306, id: 'lm-orrery', axis: 'h', m: 3.0, tris: 25000, tier: 'hero', planned: [2.0, 3.0, 2.0], role: 'Orrery Court landmark: brass armillary sphere on a stone column',
    front: 'front +Z = the concept view (the meridian ring faces +Z)'},
  {n: 307, id: 'bk-bookcase', axis: 'h', m: 2.4, tris: 8000, tier: 'fixture', planned: [1.6, 2.4, 0.45], measure: ['shelfY'], role: 'books: tall oak bookcase (open shelves, closed back)',
    front: 'front +Z = the open shelves (the closed back panel is at -Z)'},
  {n: 308, id: 'bk-table', axis: 'w', m: 1.5, tris: 6000, tier: 'fixture', planned: [1.5, 1.1, 1.5], measure: ['tiers'], role: 'books: three-tier round display table',
    front: 'front +Z = the concept view (round, the same all round)'},
  {n: 309, id: 'bk-armchair', axis: 'h', m: 1.1, tris: 8000, tier: 'fixture', planned: [0.9, 1.1, 0.85], measure: ['seatY'], role: 'books: green leather wingback armchair',
    front: 'front +Z = the seat (the wingback is at -Z)'},
  {n: 310, id: 'bk-stack', axis: 'w', m: 0.32, tris: 3000, tier: 'small', planned: [0.32, 0.22, 0.24], role: 'books: loose stack of six old hardback books',
    front: 'front +Z = the concept view (the stack read from the side)'},
  {n: 311, id: 'of-canoe', axis: 'l', m: 5.0, tris: 10000, tier: 'fixture', planned: [5.0, 0.7, 0.95], measure: ['hangY'], role: 'outfitter: red canvas canoe (hung overhead)',
    front: 'front +Z = the concept side elevation; long axis X (symmetric bow / stern); hull keel down (natural up kept for hanging)'},
  {n: 312, id: 'of-tent', axis: 'w', m: 2.1, tris: 8000, tier: 'fixture', planned: [2.1, 1.25, 2.1], role: 'outfitter: pitched dome tent with guy lines and pegs',
    front: 'front +Z = the open door'},
  {n: 313, id: 'of-backpack', axis: 'h', m: 0.8, tris: 5000, tier: 'small', planned: [0.45, 0.8, 0.3], role: 'outfitter: expedition backpack with a bedroll',
    front: 'front +Z = the pack front (pockets; the harness side is at -Z)'},
  {n: 314, id: 'of-lantern', axis: 'h', m: 0.36, tris: 3000, tier: 'small', planned: [0.2, 0.36, 0.2], role: 'outfitter: hurricane lantern',
    front: 'front +Z = the concept view (the bail handle spans x)'},
  {n: 315, id: 'of-campchair', axis: 'h', m: 0.9, tris: 5000, tier: 'fixture', planned: [0.75, 0.9, 0.6], measure: ['seatY'], role: 'outfitter: folding camp chair with a cup holder',
    front: 'front +Z = the seat (the backrest is at -Z; the cup holder on the -X arm)'},
  {n: 316, id: 'mu-bins', axis: 'w', m: 1.8, tris: 6000, tier: 'fixture', planned: [1.8, 0.95, 0.75], measure: ['bins'], role: 'music: record bin rack (twelve open compartments in two rows on a slope)',
    front: 'front +Z = the browsing side (the compartments slope up from the front lip to the back rim; the closed back panel is at -Z)'},
  {n: 317, id: 'mu-crate', axis: 'w', m: 0.36, tris: 3000, tier: 'small', planned: [0.36, 0.35, 0.36], role: 'music: crate of records', front: null},
  {n: 318, id: 'mu-guitar', axis: 'h', m: 1.05, tris: 6000, tier: 'small', planned: [0.4, 1.05, 0.45], role: 'music: electric guitar on a floor stand',
    front: 'front +Z = the guitar top (pickups / controls face +Z)'},
  {n: 319, id: 'mu-piano', axis: 'w', m: 1.5, tris: 10000, tier: 'fixture', planned: [1.5, 1.25, 0.6], role: 'music: upright piano',
    front: 'front +Z = the keyboard (the closed back is at -Z)'},
  {n: 320, id: 'mu-drums', axis: 'w', m: 1.8, tris: 12000, tier: 'fixture', planned: [1.8, 1.4, 1.4], role: 'music: drum kit with cymbals on stands',
    front: 'front +Z = the audience side (the bass-drum head faces +Z; the drummer sits at -Z)'},
  {n: 321, id: 'mu-amp', axis: 'h', m: 1.3, tris: 5000, tier: 'fixture', planned: [0.75, 1.3, 0.4], role: 'music: guitar amp head on its speaker cabinet',
    front: 'front +Z = the grille and the control panel'},
  {n: 322, id: 'hb-diorama', axis: 'w', m: 3.0, tris: 25000, tier: 'fixture', planned: [3.0, 1.3, 1.6], measure: ['topY'], role: 'hobby: model-railway prairie diorama', front: null},
  {n: 323, id: 'hb-vitrine', axis: 'h', m: 1.9, tris: 8000, tier: 'fixture', planned: [0.9, 1.9, 0.9], role: 'hobby: sealed display vitrine', front: null},
  {n: 324, id: 'hb-kits', axis: 'w', m: 0.45, tris: 3000, tier: 'small', planned: [0.45, 0.4, 0.32], role: 'hobby: stack of model-kit boxes', front: null},
  {n: 347, id: 'hb-robot', axis: 'h', m: 1.0, tris: 10000, tier: 'small', planned: [0.55, 1.0, 0.45], role: 'hobby: giant tin-toy robot model', front: null},
  {n: 326, id: 'ds-sofa', axis: 'w', m: 2.1, tris: 8000, tier: 'fixture', planned: [2.1, 0.85, 0.9], measure: ['seatY'], role: 'design: mid-century three-seat sofa',
    front: 'front +Z = the seats (the back is at -Z)'},
  {n: 327, id: 'ds-eggchair', axis: 'h', m: 1.1, tris: 8000, tier: 'fixture', planned: [0.9, 1.1, 0.9], measure: ['seatY'], role: 'design: egg chair on a four-star swivel base',
    front: 'front +Z = the seat opening (the shell back is at -Z)'},
  {n: 328, id: 'ds-lamp', axis: 'h', m: 2.1, tris: 5000, tier: 'fixture', planned: [1.7, 2.1, 0.45], role: 'design: arc floor lamp', front: null},
  {n: 329, id: 'ds-table', axis: 'w', m: 2.2, tris: 6000, tier: 'fixture', planned: [2.2, 0.75, 1.0], measure: ['topY'], role: 'design: live-edge dining table', front: null},
  {n: 330, id: 'ds-bed', axis: 'l', m: 2.2, tris: 10000, tier: 'fixture', planned: [1.7, 1.1, 2.2], measure: ['topY'], role: 'design: showroom bed', front: null},
  {n: 331, id: 'gd-bench', axis: 'w', m: 2.0, tris: 6000, tier: 'fixture', planned: [2.0, 0.8, 0.7], measure: ['topY'], role: 'garden: slatted plant bench', front: null},
  {n: 332, id: 'gd-palm', axis: 'h', m: 2.2, tris: 10000, tier: 'fixture', planned: [1.4, 2.2, 1.4], role: 'garden: potted palm', front: null},
  {n: 333, id: 'gd-pot', axis: 'h', m: 0.35, tris: 4000, tier: 'small', planned: [0.3, 0.35, 0.3], role: 'garden: geranium pot', front: null},
  {n: 334, id: 'gd-barrow', axis: 'l', m: 1.5, tris: 6000, tier: 'fixture', planned: [1.5, 0.7, 0.65], role: 'garden: wheelbarrow', front: null},
  {n: 335, id: 'ar-pinball', axis: 'h', m: 1.9, tris: 15000, tier: 'fixture', planned: [0.75, 1.9, 1.4], role: 'arcade: pinball machine', front: null},
  {n: 336, id: 'ar-airhockey', axis: 'l', m: 2.1, tris: 8000, tier: 'fixture', planned: [2.1, 0.85, 1.2], measure: ['topY'], role: 'arcade: air hockey table', front: null},
  {n: 337, id: 'ar-claw', axis: 'h', m: 1.9, tris: 10000, tier: 'fixture', planned: [0.95, 1.9, 0.95], role: 'arcade: claw crane', front: null},
  {n: 338, id: 'cn-popcorn', axis: 'h', m: 1.6, tris: 8000, tier: 'fixture', planned: [0.95, 1.6, 0.65], role: 'cinema: popcorn cart', front: null},
  {n: 339, id: 'cn-seats', axis: 'w', m: 2.4, tris: 10000, tier: 'fixture', planned: [2.4, 1.0, 0.75], measure: ['seatY'], role: 'cinema: row of cinema seats', front: null},
  {n: 340, id: 'cn-booth', axis: 'h', m: 2.4, tris: 8000, tier: 'fixture', planned: [1.6, 2.4, 1.4], role: 'cinema: ticket booth', front: null},
  {n: 341, id: 'sc-telescope', axis: 'h', m: 1.7, tris: 6000, tier: 'fixture', planned: [1.3, 1.7, 0.9], role: 'science: telescope on a tripod', front: null},
  {n: 342, id: 'sc-globe', axis: 'h', m: 1.2, tris: 8000, tier: 'fixture', planned: [0.75, 1.2, 0.75], role: 'science: giant floor globe', front: null},
  {n: 343, id: 'sc-rocket', axis: 'h', m: 2.2, tris: 8000, tier: 'fixture', planned: [0.9, 2.2, 0.9], role: 'science: rocket model', front: null},
  {n: 344, id: 'sc-mobile', axis: 'w', m: 3.0, tris: 10000, tier: 'fixture', planned: [3.0, 1.6, 3.0], measure: ['hangY'], role: 'science: hanging planet mobile', front: null},
  {n: 345, id: 'hk-net', axis: 'w', m: 1.83, tris: 6000, tier: 'fixture', planned: [1.83, 1.22, 1.1], role: 'hockey: goal net', front: null},
  {n: 346, id: 'hk-goalie', axis: 'h', m: 1.95, tris: 12000, tier: 'fixture', planned: [0.9, 1.95, 0.6], role: 'hockey: goalie display mannequin', front: null},
];
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, targetError: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept)'};
/** Above this relative error the seam-preserving result counts as visibly crumpled: the source mesh is kept instead. */
const MAX_KEEP_ERROR = 0.05;
/** JPEG encodes per slot (channel-packed metallic-roughness and normals without chroma subsampling). */
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};

// ---------- records ----------
const ledger = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ack = JSON.parse(fs.readFileSync(path.join(GEN, 'FINANCIAL-ACK.json'), 'utf8'));
const open = ledger.find(e => e.event === 'open');
const approvalSha = sha(fs.readFileSync(path.join(TDIR, 'USER-GENERATION-APPROVAL.json')));
if (approvalSha !== ack.approvalSha256 || approvalSha !== open.approvalSha256) throw new Error('USER-GENERATION-APPROVAL.json sha256 does not match FINANCIAL-ACK.json / the ledger open line');
const toolM = /^(mcp__meshy__meshy_image_to_3d) \(installed MCP ([\d.]+)[;)]/.exec(ack.tool);
if (!toolM) throw new Error(`FINANCIAL-ACK tool not recognised: ${ack.tool}`);
const MESHY_TOOL = `${toolM[1]} (MCP ${toolM[2]})`;
const last = ledger[ledger.length - 1];
if (last.billed + last.reserved > open.caps.meshyCredits || last.attempts > open.caps.attempts || last.paidPOSTs > open.caps.paidPOSTs) throw new Error(`ledger outside the caps: ${JSON.stringify(last)}`);
const assets = new Map(JSON.parse(fs.readFileSync(path.join(GEN, 'assets.json'), 'utf8')).map(a => [a.id, a]));
if (assets.size !== ROWS.length) throw new Error(`assets.json has ${assets.size} pieces, ROWS ${ROWS.length}`);
for (const row of ROWS) {
  const a = assets.get(row.id);
  if (!a || a.n !== row.n || a.size.axis !== row.axis || a.size.m !== row.m || a.polycount !== row.tris || a.tier !== row.tier) throw new Error(`${row.id}: ROWS disagrees with assets.json`);
}
const seq = e => ledger.indexOf(e) + 1;
const named = (e, raw) => (e.taskId && raw.file.includes(e.taskId)) || (e.file && e.file === raw.file);

/** The raw to build (accepted, or with --include-pending the latest unjudged one) + its chain of ledger lines; null = nothing to build. */
function records(asset) {
  const lines = ledger.filter(e => e.asset === asset);
  const raws = lines.filter(e => e.event === 'raw');
  const accept = lines.filter(e => e.event === 'accept').pop() ?? null;
  let raw;
  if (accept) raw = raws.find(r => named(accept, r)) ?? raws.filter(r => seq(r) < seq(accept)).pop();
  else if (PENDING) raw = raws[raws.length - 1];
  if (!raw) return null;
  const reject = lines.filter(e => e.event === 'reject' && seq(e) > seq(raw) && (named(e, raw) || !(e.taskId || e.file))).pop() ?? null;
  if (reject && (!accept || seq(reject) > seq(accept))) return null;
  const one = (pred, what) => { const m = ledger.filter(pred); if (m.length !== 1) throw new Error(`${asset}: expected exactly one ${what} line, found ${m.length}`); return m[0]; };
  const posted = one(e => e.event === 'posted' && e.asset === asset && raw.file.includes(e.taskId), 'posted');
  const status = one(e => e.event === 'status' && e.asset === asset && e.taskId === posted.taskId, 'status');
  if (status.status !== 'SUCCEEDED' || seq(status) > seq(raw)) throw new Error(`${asset}: task status mismatch`);
  const intent = ledger.filter(e => e.event === 'intent' && e.kind === 'meshy-image-to-3d' && e.asset === asset && seq(e) < seq(posted)).pop();
  if (!intent) throw new Error(`${asset}: no Meshy intent line before the posted line`);
  const settings = intent.settings;
  for (const k of ['ai_model', 'model_type', 'should_texture', 'texture_resolution', 'enable_pbr']) if (settings[k] !== ack.settings[k]) throw new Error(`${asset}: intent setting ${k} differs from FINANCIAL-ACK`);
  if (JSON.stringify(settings.target_formats) !== JSON.stringify(ack.settings.target_formats) || !(settings.target_polycount <= 30000)) throw new Error(`${asset}: intent formats / polycount outside FINANCIAL-ACK`);
  const codex = one(e => e.event === 'result' && e.kind === 'codex-image' && e.rc === 0 && e.files?.some(f => f.raw === intent.input && f.sha256 === intent.inputSha256), 'Codex concept result');
  const codexIntent = ledger.filter(e => e.event === 'intent' && e.kind === 'codex-image' && e.n === codex.n && seq(e) < seq(codex)).pop();
  const inputFile = codex.files.find(f => f.raw === intent.input);
  if (sha(fs.readFileSync(path.join(GEN, inputFile.raw))) !== intent.inputSha256) throw new Error(`${asset}: Codex concept file sha256 mismatch`);
  const bytes = fs.readFileSync(path.join(GEN, raw.file));
  if (sha(bytes) !== raw.sha256 || bytes.length !== raw.bytes) throw new Error(`${asset}: raw original sha256 / bytes mismatch (${raw.file})`);
  return {accept, raw, intent, posted, status, settings, codex, codexIntent, inputFile, bytes};
}

// ---------- geometry ----------
async function readSource(rec) {
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes();
  if (nodes.length !== 1 || !nodes[0].getMesh() || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) throw new Error('expected one node / mesh / material');
  if (nodes[0].getWorldMatrix().some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) throw new Error('non-identity source node');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4 || prims[0].getAttribute('TANGENT') || prims[0].listSemantics().join() !== 'POSITION,NORMAL,TEXCOORD_0') throw new Error('expected one POSITION / NORMAL / TEXCOORD_0 triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) throw new Error('unexpected material (alpha / occlusion / emissive)');
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) if (!info || info.getTexCoord() !== 0) throw new Error('a map is missing or uses TEXCOORD_1');
  const m = {P: Float32Array.from(p.getAttribute('POSITION').getArray()), N: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), I: Uint32Array.from(p.getIndices().getArray())};
  const maps = [['baseColor', mat.getBaseColorTexture()], ['metallicRoughness', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()]]
    .map(([slot, t]) => ({slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  return {doc, prim: p, mat, m, maps, material};
}

/** Exact-attribute weld (bitwise-equal position / normal / uv) + degenerate-triangle removal; lossless. */
function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) {
    A.set(m.P.subarray(3 * v, 3 * v + 3), v * stride); A.set(m.N.subarray(3 * v, 3 * v + 3), v * stride + 3); A.set(m.UV.subarray(2 * v, 2 * v + 2), v * stride + 6);
  }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [];
  for (let v = 0; v < nv; v++) {
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
  return {P, N, UV, I: Uint32Array.from(I), weld: {verticesBefore: nv, verticesAfter: n, degenerateTrianglesDropped: degenerate}};
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

/** Seam-preserving simplification on the welded source buffer (UVs / normals kept); `kept` + reason when it stalls or crumples. */
async function simplify(m, budget) {
  const tris0 = m.I.length / 3;
  if (tris0 <= budget) return {m, info: {applied: false, reason: `already within the ${budget} budget`, triangles: tris0, budget}};
  await MeshoptSimplifier.ready;
  const nv = m.P.length / 3, attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) attrs[5 * v + k] = m.N[3 * v + k] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget (or makes no progress)
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 10; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, SIMPLIFY.targetError, []);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  const attempt = {fromTriangles: tris0, triangles: out.length / 3, budget, askedTriangles: ask, passes: passes + 1, errorRelative: r6(err)};
  if (out.length / 3 > budget) return {m, info: {applied: false, reason: `the UV seams stall the seam-preserving collapse at ${out.length / 3} triangles (> the ${budget} budget): source mesh kept rather than smear the texture`, triangles: tris0, budget, attempt}};
  if (err > MAX_KEEP_ERROR) return {m, info: {applied: false, reason: `the seam-preserving result at the budget is visibly crumpled (relative error ${r6(err)} > ${MAX_KEEP_ERROR}): source mesh kept`, triangles: tris0, budget, attempt}};
  const map = new Int32Array(nv).fill(-1), P = [], N = [], UV = [], I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (map[v] < 0) { map[v] = P.length / 3; P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    I[i] = map[v];
  }
  return {m: {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I},
    info: {applied: true, tool: SIMPLIFY.tool, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, targetError: SIMPLIFY.targetError, ...attempt,
      errorSourceUnits: r6(err * MeshoptSimplifier.getScale(m.P, 3))}};
}

function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return {min, max};
}

/** Quarter turns about +Y (exact: no trigonometry rounding), applied to positions and normals alike. */
function turnY(A, deg) {
  const q = (((deg / 90) % 4) + 4) % 4;
  if (!Number.isInteger(q)) throw new Error(`turn ${deg} is not a quarter turn`);
  const out = Float32Array.from(A);
  for (let i = 0; i < out.length; i += 3) {
    const x = A[i], z = A[i + 2];
    // +90 deg (counter-clockwise from above): x' = z, z' = -x
    if (q === 1) { out[i] = z; out[i + 2] = -x; } else if (q === 2) { out[i] = -x; out[i + 2] = -z; } else if (q === 3) { out[i] = -z; out[i + 2] = x; }
  }
  return out;
}

/** Top-down height map (max y per `cell` x `cell` column, sampled at the cell centres) of the indexed mesh. */
function heightMap(P, I, cell) {
  const b = boundsOf(P), x0 = b.min[0], z0 = b.min[2];
  const nx = Math.ceil((b.max[0] - x0) / cell) + 1, nz = Math.ceil((b.max[2] - z0) / cell) + 1;
  const H = new Float32Array(nx * nz).fill(-Infinity);
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], bb = 3 * I[f + 1], c = 3 * I[f + 2];
    const ax = P[a], az = P[a + 2], bx = P[bb], bz = P[bb + 2], cx = P[c], cz = P[c + 2];
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell)), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (k + 0.5) * cell;
      const w0 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area, w1 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
      const y = w0 * P[a + 1] + w1 * P[bb + 1] + w2 * P[c + 1];
      if (y > H[k * nx + i]) H[k * nx + i] = y;
    }
  }
  return {H, nx, nz, x0, z0, cell};
}
const cellX = (hm, i) => hm.x0 + ((i % hm.nx) + 0.5) * hm.cell, cellZ = (hm, i) => hm.z0 + (Math.floor(i / hm.nx) + 0.5) * hm.cell;
const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

/** The broadest flat top among the cells passing `keep`: the 2 cm height window holding the most cells; its median height and extent. */
function plateau(hm, keep = () => true) {
  const {H} = hm, bin = 0.002, half = 5;
  const hs = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H.length; i++) if (Number.isFinite(H[i]) && keep(i)) { hs.push(i); lo = Math.min(lo, H[i]); hi = Math.max(hi, H[i]); }
  if (!hs.length) throw new Error('plateau: no cells');
  const nb = Math.ceil((hi - lo) / bin) + 1;
  const hist = new Int32Array(nb);
  for (const i of hs) hist[Math.floor((H[i] - lo) / bin)]++;
  let best = -1, bestN = -1;
  for (let c = 0; c < nb; c++) { let n = 0; for (let d = -half; d <= half; d++) n += hist[c + d] ?? 0; if (n > bestN) { bestN = n; best = c; } }
  const y0 = lo + (best - half) * bin, y1 = lo + (best + half + 1) * bin;
  const cells = hs.filter(i => H[i] >= y0 && H[i] < y1);
  const ys = cells.map(i => H[i]).sort((p, q) => p - q);
  const x = [Infinity, -Infinity], z = [Infinity, -Infinity];
  for (const i of cells) { const cx = cellX(hm, i), cz = cellZ(hm, i); x[0] = Math.min(x[0], cx); x[1] = Math.max(x[1], cx); z[0] = Math.min(z[0], cz); z[1] = Math.max(z[1], cz); }
  return {y: ys[ys.length >> 1], cells: cells.length, of: hs.length, areaM2: cells.length * hm.cell * hm.cell, ySpread: [ys[0], ys[ys.length - 1]], x, z};
}

/** Every crossing of the vertical line (x, z) with the mesh: height + the interpolated vertex-normal y (> 0 = an up-facing surface). */
function columnHits(P, N, I, x, z) {
  const out = [];
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2];
    const area = (P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2]);
    if (Math.abs(area) < 1e-14) continue;
    const w0 = ((P[b] - x) * (P[c + 2] - z) - (P[c] - x) * (P[b + 2] - z)) / area, w1 = ((P[c] - x) * (P[a + 2] - z) - (P[a] - x) * (P[c + 2] - z)) / area, w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    out.push({y: w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1], ny: w0 * N[a + 1] + w1 * N[b + 1] + w2 * N[c + 1]});
  }
  return out.sort((p, q) => p.y - q.y);
}

/**
 * Shelf tops: vertical lines through the bays (11 across the inner 72 % of the width x 3 depths between 30 and 60 % of the depth from
 * the back); per line the up-facing crossings with open space (>= 12 cm) to the next crossing above and something above (the case top
 * itself is not a shelf); crossings within 3 cm merged (the board's top face). A shelf = a height found on >= 60 % of the lines.
 */
function shelfHeights(P, N, I, dims) {
  const lines = [];
  for (let i = 0; i < 11; i++) for (const fz of [0.3, 0.45, 0.6]) lines.push([(-0.36 + 0.072 * i) * dims[0], (-0.5 + fz) * dims[2]]);
  const found = [];
  for (const [x, z] of lines) {
    const hits = columnHits(P, N, I, x, z), tops = [];
    for (let k = 0; k + 1 < hits.length; k++) {
      if (hits[k].ny <= 0.3 || hits[k + 1].y - hits[k].y < 0.12) continue;
      if (tops.length && hits[k].y - tops[tops.length - 1] < 0.03) tops[tops.length - 1] = hits[k].y; else tops.push(hits[k].y);
    }
    found.push(...tops);
  }
  found.sort((p, q) => p - q);
  const groups = [];
  for (const y of found) { const g = groups[groups.length - 1]; if (g && y - g[g.length - 1] < 0.03) g.push(y); else groups.push([y]); }
  const shelves = groups.filter(g => g.length >= 0.6 * lines.length).map(g => r4(median(g)));
  return {shelfY: shelves, shelves: {method: `vertical lines through the bays (${lines.length}: 11 across the inner 72 % of the width x 3 depths at 30 / 45 / 60 % of the depth from the back); up-facing crossings with >= 12 cm open above and a crossing above (the case top excluded), merged within 3 cm; a shelf = a height on >= 60 % of the lines; median`,
    lines: lines.length, hitsPerShelf: groups.filter(g => g.length >= 0.6 * lines.length).map(g => g.length)}};
}

/** Seat top: the broadest flat top of a 1 cm height map over the seat's middle (|x| < 18 % of the width, the front half of the depth). */
function seatHeight(P, I, dims) {
  const hm = heightMap(P, I, 0.01);
  const pl = plateau(hm, i => Math.abs(cellX(hm, i)) < 0.18 * dims[0] && cellZ(hm, i) > -0.05 * dims[2] && cellZ(hm, i) < 0.4 * dims[2]);
  return {seatY: r4(pl.y), seat: {method: 'broadest 2 cm height window of a 1 cm top-down height map over |x| < 18 % w, z from -5 % to +40 % of d (the seat middle, front half); median',
    cells: pl.cells, of: pl.of, ySpread: pl.ySpread.map(r4)}};
}

/**
 * Tiers of a round tiered table: the radial profile (median top height per 1 cm ring) split into runs flat within 2 cm and >= 6 cm wide,
 * above 10 % of the height (the bk-table's octagonal centre column is hollow: looking down it sees the floor plate). tierRIn = the inner
 * edge of the ring seen from above (the tier above's edge; for the top tier its open centre).
 */
function tierHeights(P, I, dims) {
  const hm = heightMap(P, I, 0.01), bins = [];
  for (let i = 0; i < hm.H.length; i++) {
    if (!Number.isFinite(hm.H[i])) continue;
    const r = Math.floor(Math.hypot(cellX(hm, i), cellZ(hm, i)) / 0.01);
    (bins[r] ??= []).push(hm.H[i]);
  }
  const prof = bins.map(b => (b?.length ? median(b) : null));
  const runs = [];
  let cur = null;
  prof.forEach((h, r) => {
    if (h == null) return;
    if (cur && Math.abs(h - median(cur.h)) < 0.02) { cur.h.push(h); cur.r1 = r; } else { if (cur) runs.push(cur); cur = {r0: r, r1: r, h: [h]}; }
  });
  if (cur) runs.push(cur);
  const tiers = runs.filter(t => (t.r1 - t.r0 + 1) * 0.01 >= 0.06 && median(t.h) > 0.1 * dims[1])
    .map(t => ({y: r4(median(t.h)), rOuter: r4((t.r1 + 1) * 0.01), rInner: r4(t.r0 * 0.01)})).sort((p, q) => p.y - q.y);
  if (tiers.length < 2) throw new Error('tiers: fewer than two tiers found');
  return {tierY: tiers.map(t => t.y), tierR: tiers.map(t => t.rOuter), tierRIn: tiers.map(t => t.rInner), topY: tiers[tiers.length - 1].y,
    tiers: {method: 'radial profile of a 1 cm top-down height map (median height per 1 cm ring about the centre), split into runs flat within 2 cm; tiers = runs >= 6 cm wide above 10 % of the height; tierR = the run\'s outer radius (the tier edge), tierRIn = its inner radius seen from above (the tier above overhangs inside it; the top tier\'s open centre)',
      rings: tiers, openCentre: runs.filter(t => median(t.h) <= 0.1 * dims[1] && t.r0 === 0).map(t => ({rOuter: r4((t.r1 + 1) * 0.01), y: r4(median(t.h))}))}};
}

/** A sloped bin rack: the top-most up-facing crossing along the centre line x = 0, front (+Z) to back; topY = the front lip, backY = the back. */
function binSlope(P, N, I, dims) {
  const prof = [];
  for (let i = 0; i <= 40; i++) {
    const z = (0.48 - 0.024 * i) * dims[2], up = columnHits(P, N, I, 0, z).filter(h => h.ny > 0.3);
    if (up.length) prof.push([r4(z), r4(up[up.length - 1].y)]);
  }
  const front = prof.slice(0, 4).map(p => p[1]);
  return {topY: r4(Math.max(...front)), backY: r4(Math.max(...prof.map(p => p[1]))),
    bins: {method: 'the top-most up-facing crossing of vertical lines along x = 0 from z = +48 % to -48 % of the depth; topY = the front lip (max of the 4 front-most), backY = the highest (the back rim)', profile: prof}};
}

// ---------- build ----------
const outRows = [];
for (const row of ROWS) {
  if (ONLY && !ONLY.includes(row.id)) continue;
  const rec = records(row.id);
  if (!rec) continue;
  if (!row.front) {
    if (rec.accept) throw new Error(`${row.id}: accepted, but its front / orientation has not been reviewed on the acceptance renders (ROWS front: null)`);
    console.log(`${row.id}: pending raw not built (held on the acceptance review: ROWS front: null)`);
    continue;
  }
  const id = `skyways-d-${row.id}`, key = `skyways_d_${row.id.replace(/-/g, '_')}`, url = `assets/models/${id}.glb`, provRel = `assets/derivatives/${id}-model.json`;
  const src = await readSource(rec);
  const srcB = boundsOf(src.m.P);
  const extent = [0, 1, 2].map(k => r4(srcB.max[k] - srcB.min[k]));
  const welded = weld(src.m);
  const charts = uvCharts(welded);
  const {m: low, info: simp} = await simplify(welded, row.tris);
  // ---- orient: quarter turn about Y (positions + normals); then UNIFORM scale (s) on the size axis; grounded, centred on x / z
  const turn = row.turn ?? 0;
  const P0 = turn ? turnY(low.P, turn) : low.P, N = turn ? turnY(low.N, turn) : low.N;
  const b = boundsOf(P0);
  const ext = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  if (row.axis === 'l' && ext[0] < ext[2]) throw new Error(`${row.id}: an 'l' piece must be long along X after the turn`);
  const k = {h: 1, w: 0, l: 0, d: 2}[row.axis];
  const s = row.m / ext[k];
  const tx = -s * (b.min[0] + b.max[0]) / 2, ty = -s * b.min[1], tz = -s * (b.min[2] + b.max[2]) / 2;
  const P = new Float32Array(P0.length);
  for (let i = 0; i < P.length; i += 3) { P[i] = s * P0[i] + tx; P[i + 1] = s * P0[i + 1] + ty; P[i + 2] = s * P0[i + 2] + tz; }
  const fit = {axis: row.axis, kind: {h: 'the full height (y)', w: 'the full width (x)', l: 'the long axis (x)', d: 'the full depth (z)'}[row.axis], size: row.m, scale: r6(s),
    translate: [tx, ty, tz].map(r6), turnDegY: turn, measuredOn: 'the welded (and simplified) mesh that ships', rotation: turn ? `${turn} deg about +Y (exact quarter turn of positions and normals)` : 'none (Meshy native front +Z kept)'};
  // ---- write into the source document (its material + PBR maps kept; maps re-encoded / downsized only)
  const {doc, prim, mat} = src;
  const r = doc.getRoot();
  const nv = P.length / 3;
  prim.getAttribute('POSITION').setArray(P);
  prim.getAttribute('NORMAL').setArray(Float32Array.from(N));
  prim.getAttribute('TEXCOORD_0').setArray(Float32Array.from(low.UV));
  prim.getIndices().setArray(nv < 65536 ? Uint16Array.from(low.I) : Uint32Array.from(low.I));
  const tex = TEX[row.tier];
  for (const [slot, t, px] of [['baseColor', mat.getBaseColorTexture(), tex[0]], ['metallicRoughness', mat.getMetallicRoughnessTexture(), tex[1]], ['normal', mat.getNormalTexture(), tex[2]]]) {
    const img = await sharp(Buffer.from(t.getImage())).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI(`${id}-${slot}.jpg`).setName(`${id}-${slot}`);
  }
  r.listMeshes()[0].setName(id); r.listNodes()[0].setName(id); mat.setName(id);
  r.listScenes().forEach(sc => sc.setName(id));
  await doc.transform(dedup(), prune());
  r.getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error(`${id}: URL / token-like string inside the glTF JSON`);
  // ---- verify the written bytes + measure on them
  const chk = await io.readBinary(new Uint8Array(glb));
  const cr = chk.getRoot();
  const bb = getBounds(cr.getDefaultScene() ?? cr.listScenes()[0]);
  const dims = [0, 1, 2].map(q => r4(bb.max[q] - bb.min[q]));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 1e-3 || Math.abs(bb.min[2] + bb.max[2]) > 1e-3) throw new Error(`${id}: not grounded / centred`);
  if (Math.abs(dims[k] - row.m) > 1e-3) throw new Error(`${id}: size axis ${row.axis} is ${dims[k]}, not ${row.m}`);
  const cp = cr.listMeshes()[0].listPrimitives()[0];
  const tris = cp.getIndices().getCount() / 3;
  if (simp.applied && tris > row.tris) throw new Error(`${id}: over budget`);
  const CP = cp.getAttribute('POSITION').getArray(), CN = cp.getAttribute('NORMAL').getArray(), CI = cp.getIndices().getArray();
  const measures = {};
  for (const ms of row.measure ?? []) {
    if (ms === 'shelfY') Object.assign(measures, shelfHeights(CP, CN, CI, dims));
    else if (ms === 'seatY') Object.assign(measures, seatHeight(CP, CI, dims));
    else if (ms === 'tiers') Object.assign(measures, tierHeights(CP, CI, dims));
    else if (ms === 'bins') Object.assign(measures, binSlope(CP, CN, CI, dims));
    else if (ms === 'hangY') Object.assign(measures, {hangY: dims[1], hang: {method: 'the top of the model (min y = 0): the hanging point'}});
    else if (ms === 'topY') {
      const hm = heightMap(CP, CI, 0.01), pl = plateau(hm, i => hm.H[i] > 0.4 * dims[1]);
      Object.assign(measures, {topY: r4(pl.y), top: {method: 'broadest 2 cm height window of a 1 cm top-down height map above 40 % of the height; median', areaM2: r4(pl.areaM2),
        ySpread: pl.ySpread.map(r4), x: pl.x.map(r4), z: pl.z.map(r4)}});
    } else throw new Error(`${id}: unknown measure ${ms}`);
  }
  const mats = cr.listMaterials();
  const textures = cr.listTextures().map(t => ({slot: [['baseColor', mats[0].getBaseColorTexture()], ['metallicRoughness', mats[0].getMetallicRoughnessTexture()], ['normal', mats[0].getNormalTexture()]].find(([, x]) => x === t)?.[0] ?? 'unused',
    size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  outRows.push({row, id, key, url, provRel, rec, src, extent, welded, charts, simp, fit, glb, dims, min: bb.min.map(r6), max: bb.max.map(r6), tris, vertices: cp.getAttribute('POSITION').getCount(), measures, textures});
  const extras = Object.entries(measures).filter(([, v]) => typeof v === 'number' || (Array.isArray(v) && typeof v[0] === 'number')).map(([q, v]) => `, ${q} ${Array.isArray(v) ? `[${v.join(' ')}]` : v}`).join('');
  console.log(`${id}: ${rec.bytes.length} B ${src.m.I.length / 3} tris -> ${glb.length} B ${tris} tris (${simp.applied ? `simplified, err ${simp.errorRelative}` : simp.reason}; ${charts} UV charts), dims ${dims.join(' x ')} m, ` +
    `scale ${s.toFixed(4)}${turn ? `, turn ${turn}` : ''}${extras}; ${rec.accept ? 'accepted' : 'PENDING acceptance'}; maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}

if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const o of outRows) fs.writeFileSync(path.join(DRY, `${o.id}.glb`), o.glb);
  console.log('dry run: GLBs written to', DRY);
  process.exit(0);
}

// ---------- outputs ----------
const written = new Map();
for (const o of outRows) {
  const {row, rec} = o;
  const line = (({event: _e, ...rest}) => rest);
  const prov = {
    schema: 'terminal-state-derivative-v1',
    id: o.id,
    key: o.key,
    piece: {n: row.n, id: row.id, tier: row.tier, size: {axis: row.axis, m: row.m}, budget: row.tris},
    role: row.role,
    task: `${TASK} (Skyways destinations lane KITS; models generated by the destinations lead, the sole paid owner)`,
    approval: {userGenerationApprovalSha256: approvalSha,
      summary: `the user's Skyways destinations generation approval: a NEW ${open.caps.meshyCredits}-credit Meshy T2.5 ledger (caps ${open.caps.attempts} attempts / ${open.caps.paidPOSTs} paid POSTs); Codex concept images uncapped but recorded; first acceptable result per piece`},
    accepted: !!rec.accept,
    route: 'Codex native image_gen INITIAL concept image (straight-on elevation) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (re-encoded / downsized only; no re-texture, projection or hand-painted replacement)',
    conditioningImage: {codexCall: rec.codex.n, sha256: rec.inputFile.sha256, bytes: rec.inputFile.bytes, promptSha256: rec.codexIntent?.promptSha256 ?? null,
      generator: 'OpenAI Codex CLI 0.163.0 built-in image_gen (image model id not reported)', file: `${TASK_DIR}/gen/${rec.inputFile.raw} (raw original, outside Git)`},
    meshy: {
      tool: MESHY_TOOL, request: rec.settings, task: rec.posted.taskId, status: rec.status.status, consumedCredits: rec.status.consumed_credits,
      evidence: 'the create arguments are fixed in FINANCIAL-ACK.json and the fsynced ledger intent line before the POST; 15 credits = the T2 / T2.5 single-image textured price; the task GET response does not echo ai_model',
      ledger: {file: `${TASK_DIR}/gen/LEDGER.jsonl (outside Git)`, lines: {intent: seq(rec.intent), posted: seq(rec.posted), status: seq(rec.status), raw: seq(rec.raw), accept: rec.accept ? seq(rec.accept) : null},
        codexLines: {intent: rec.codexIntent ? seq(rec.codexIntent) : null, result: seq(rec.codex)}, accept: rec.accept ? line(rec.accept) : null},
    },
    source: {file: `${TASK_DIR}/gen/${rec.raw.file} (raw original, read-only, outside Git; never shipped)`, sha256: rec.raw.sha256, bytes: rec.raw.bytes,
      triangles: o.src.m.I.length / 3, vertices: o.src.m.P.length / 3, extent: o.extent, uvCharts: o.charts, material: o.src.material, maps: o.src.maps},
    output: {url: o.url, file: `game/public/${o.url}`, bytes: o.glb.length, sha256: sha(o.glb), triangles: o.tris, vertices: o.vertices, dims: o.dims, min: o.min, max: o.max},
    fit: o.fit,
    weld: o.welded.weld,
    simplify: o.simp,
    measurements: o.measures,
    textures: o.textures,
    texturePolicy: `Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal), lanczos3 downsize to ${TEX[row.tier].join(' / ')} px (tier ${row.tier}), JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4 (no chroma subsampling on the channel-packed and normal maps)`,
    convention: `metres at real size, +Y up; ${row.front}; grounded (min y = 0), centred on x / z; identity node (transform baked into the vertices)`,
    licence: 'generated for this project (Codex initial concept -> Meshy T2.5) under the user\'s Skyways destinations generation approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied',
    rebuild: `node ${SELF} [--reference <dir holding ${TASK_REL}>]`,
  };
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  { const hit = provBuf.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=|\/workspaces\/|\/home\/|~\/).{0,20}/i); if (hit) throw new Error(`${o.id}: URL / token / local path in public provenance: ...${hit[0]}...`); }
  written.set(o.url, o.glb);
  written.set(o.provRel, provBuf);
}
for (const [rel, buf] of written) fs.writeFileSync(path.join(PUB, rel), buf);
for (const [dir, re] of [['assets/models', /^skyways-d-.*\.glb$/], ['assets/derivatives', /^skyways-d-.*-model\.json$/]]) {
  for (const f of fs.readdirSync(path.join(PUB, dir)).filter(q => re.test(q))) if (!written.has(`${dir}/${f}`)) console.warn(`WARNING: stale ${dir}/${f} (no longer built: rejected / unaccepted?) — not allowlisted; remove it deliberately`);
}

const built = new Map(outRows.map(o => [o.row.id, o]));
const num = v => String(v);
const regLine = row => {
  const key = `skyways_d_${row.id.replace(/-/g, '_')}`, url = `assets/models/skyways-d-${row.id}.glb`, o = built.get(row.id);
  if (!o) return `  ${key}: {url: '${url}', w: ${num(row.planned[0])}, h: ${num(row.planned[1])}, d: ${num(row.planned[2])}, tris: ${row.tris}, planned: true},`;
  const m = o.measures, ex = [];
  for (const f of ['topY', 'backY', 'seatY', 'hangY']) if (m[f] != null) ex.push(`${f}: ${m[f]}`);
  for (const f of ['shelfY', 'tierY', 'tierR', 'tierRIn']) if (m[f]) ex.push(`${f}: [${m[f].join(', ')}]`);
  return `  ${key}: {url: '${url}', w: ${o.dims[0]}, h: ${o.dims[1]}, d: ${o.dims[2]}, tris: ${o.tris}${ex.map(e => `, ${e}`).join('')}},`;
};
fs.writeFileSync(REG, `// GENERATED by ${SELF} (task ${TASK}, lane KITS) — do not edit.
// The Skyways DESTINATION kit: Codex initial concept -> Meshy T2.5 image-to-3D, Meshy's own PBR maps kept (re-encoded / downsized only).
// Per-file provenance in assets/derivatives/<file>-model.json. Metres at real size, +Y up, front +Z, grounded (min y = 0), centred on
// x / z. Built rows: w / h / d = the measured runtime bounds (x / y / z extents), tris = triangles. Rows still flagged \`planned: true\`
// are not built yet (the lead's planned sizes; no file). Measured extras (metres above the floor, on the shipped mesh):
//   topY    the table / bench / board top; a sloped record-bin rack's FRONT lip (backY = its back rim; the bins slope between)
//   shelfY  the bookcase shelves' top faces (bottom board first)
//   tierY   a tiered table's tier tops (lowest first); tierR their outer radii; tierRIn the inner edge of each ring seen from above
//           (the tier above overhangs inside it; the top tier's open centre = the hollow column: never place anything inside tierRIn)
//   seatY   the seat top (cushion / fabric middle)       hangY  the hanging point (the model top) of a hung piece
export interface SkywaysDestProp {
  readonly url: string; readonly w: number; readonly h: number; readonly d: number; readonly tris: number; readonly planned?: boolean;
  readonly topY?: number; readonly backY?: number; readonly seatY?: number; readonly hangY?: number;
  readonly shelfY?: readonly number[]; readonly tierY?: readonly number[]; readonly tierR?: readonly number[]; readonly tierRIn?: readonly number[];
}

export const SKYWAYS_DEST_PROPS = {
${ROWS.map(regLine).join('\n')}
} as const satisfies Record<string, SkywaysDestProp>;
export type SkywaysDestPropKey = keyof typeof SKYWAYS_DEST_PROPS;
`);

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const own = p => /^assets\/(models\/skyways-d-[a-z0-9-]+\.glb|derivatives\/skyways-d-[a-z0-9-]+-model\.json)$/.test(p);
allow.files = [...allow.files.filter(f => !own(f.path)), ...[...written].map(([p, buf]) => ({path: p, bytes: buf.length, sha256: sha(buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
const glbBytes = outRows.reduce((t, o) => t + o.glb.length, 0);
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, buf) => t + buf.length, 0)} B; GLBs ${glbBytes} B for ${outRows.length} pieces) + ${path.relative(root, REG)} + public-inputs.json`);
