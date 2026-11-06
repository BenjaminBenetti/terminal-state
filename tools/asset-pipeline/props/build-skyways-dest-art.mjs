// Task studio-skyways-destinations-20261106-170011-01 (lane ART2D): runtime derivatives of the Skyways DESTINATIONS' Codex-generated
// ORIGINAL flat artwork — thirteen shop posters (one or more per anchor-shop family: cinema film posters, record-store gig posters, the
// bookshop's author evening, the outfitter's travel poster, a star chart, the arcade's neon poster, the hockey team poster, the model-railway
// show, the home store's catalogue ad and the garden centre's seed poster) and six cast-bronze / enamel court plaques (one per landmark
// court). Root CLAUDE.md "Textures — Codex for INITIAL sources": every source is one Codex native image_gen call through the lead's
// ledgered helper; nothing hand-drawn. Processing only: crop / resize (sharp lanczos3) / pack into JPEG atlases.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/skyways-destinations-20261106-170011/gen/):
//   LEDGER.jsonl (the intent + result row of every Codex call: call number, prompt file + sha256, output file + sha256)
//   raw/codex-<n>-exec-<id>.png (the byte-exact Codex outputs)   prompts/art2d-<n>.txt (the prompts; only their sha256 is published)
// and writes deterministically:
//   game/public/assets/textures/skyways/skyways-d-<atlas>.jpg sRGB JPEG atlases (mozjpeg q85, 4:2:0, metadata stripped)
//   game/public/assets/derivatives/skyways-d-<atlas>.json     provenance per atlas (ledger call numbers, Codex session ids, prompt and
//                                                             raw sha256s, crop / placement rects; no prompt text, no URLs, no local paths)
//   game/src/assets/skywaysDestArt.generated.ts               atlas urls / sizes / per-piece UV rects (three.js convention, v = 0 at the
//                                                             image bottom; each rect inset by half a texel against neighbour bleed) and
//                                                             the per-family / per-landmark piece lists
//   tools/release/public-inputs.json                          ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-skyways-dest-art.mjs [--dry-run | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-skyways-destinations-20261106-170011-01';
const TASK_REL = 'reference/tasks/skyways-destinations-20261106-170011';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/skyways';
const PROV_DIR_REL = 'assets/derivatives';
const TS_REL = 'game/src/assets/skywaysDestArt.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const FILL = {r: 24, g: 24, b: 28};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-skyways-dest-art: ${m}`); process.exit(1); };

// ---------- the private task folder (main checkout: <root>/reference; a .claude/worktrees/<lane> checkout: walk up) ----------
function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex outputs (one ledgered call each; `sha256` = the accepted raw file) ----------
// `box` = an optional source pixel box [x0, y0, x1, y1) to crop inside (measured on the accepted image: a plaque's own edge where the
// render left a margin), `focus` = the crop centre (0..1 of the box) where a crop to the slot's aspect is needed (default: centred).
// All nineteen were accepted at their first call (text checked letter by letter; no real logos), so no call was rejected or retried.
const SOURCES = {
  cinema1: {call: 401, sha256: '060f7bcf01aad8f95471345c8f49640d233bafa3e49bc232f1b3d596b78e4fda', subject: 'cinema film poster: invented 1950s science-fiction film "PRAIRIE STATIC"'},
  cinema2: {call: 402, sha256: 'a78d6ed65742f74d4601cc426ba3dadf90df4453b0434b381b98bf12e6614d56', subject: 'cinema film poster: invented frozen thriller "NINETY BELOW"'},
  cinema3: {call: 403, sha256: 'bf3ecfbe30ee3ed245bd8c366480ee547582cda03b77c55925c390f82e74d913', subject: 'cinema film poster: invented period drama "THE LAST STREETCAR"'},
  music1: {call: 404, sha256: 'dc4176b710a3123cf27db9b654e612f55f7a14b1e7246d4583203033206ef54f', subject: 'record-store gig poster: invented band "THE WHEATFIELD SAINTS"'},
  music2: {call: 405, sha256: 'a17b5ba6c440900d908892b69c106e3f58545e74cd36f375d3b01154599b766e', subject: 'record-store gig poster: invented band "HOARFROST"'},
  books: {call: 406, sha256: 'd68626a0e6d91ecdaea2436f1e096ff50064b53d7e710c8d2165733e21ac3621', subject: 'bookshop poster: "READINGS AT PAPER PRAIRIE BOOKS", an author evening'},
  outfitter: {call: 407, sha256: '1e2d212ae2e6aeea161c6639b96bad141451c9dcde2aec2c5630fcfe79fd083e', subject: 'outfitter travel poster: "PADDLE NORTH", an imaginary mountain-lake canoe scene'},
  science: {call: 408, sha256: '4f8375bf0f9642e84af19365e6761233e4fdbacd377ab59cf8d46afd6a810652', subject: 'science emporium star chart: "THE NORTHERN SKY"'},
  arcade: {call: 409, sha256: 'a6e3afcb3477dce3156d427e76b1541ebb2f8e57dc985572e555a3adafefe35b', subject: 'arcade neon space poster: "STARFALL ARCADE"'},
  hockey: {call: 410, sha256: '2bad9ce14fe52aaba3fe3f5177dd2367ea1b09a962d648b52b24fb204b143fe4', subject: 'sports-store team poster: invented hockey team "PRAIRIE BLIZZARD"'},
  hobby: {call: 411, sha256: '3f24ab470b34d1e9d93f19b4253ccebc748915496ab215b4c94dc994a0362289', subject: 'model-shop show poster: "GRAIN ELEVATOR MODELS" / "RAILWAY DAYS"'},
  design: {call: 412, sha256: '46e3e3de52bcbf25d7a2330d446e526cba054f2e5594d1c6b499befdfdc2c4dc', subject: 'home-store mid-century catalogue ad: "LARCH & LOOM HOME"'},
  garden: {call: 413, sha256: '9bb49ce61fd896ed4c9793f7eb8f4b9b84ec17517c354557905e174dd3fbf15b', subject: 'garden-centre botanical seed poster: "GLASSHOUSE GARDEN CO."'},
  plaque_clock: {call: 414, sha256: 'd325c7c58038a618ed91f511bea1133d0db78917a1f387d0ddb1c4b7c8b48b55', subject: 'court plaque: "CLOCK COURT"'},
  plaque_dinosaur: {call: 415, sha256: '37f68074cd485265eb37ef4c34d4e123d267e9318d5dd379a4c0f27c2a7bde1f', subject: 'court plaque: "BADLANDS COURT" (a duck-billed dinosaur cast, gift of the invented Prairie Natural History Society)'},
  plaque_fig_tree: {call: 416, sha256: '74c92acbaa5bb8335c5c4762bd5e0f2b70fc77d3e8f5a2ad1b3a6cd095e16115', subject: 'court plaque: "FIG TREE COURT"'},
  plaque_fountain: {call: 417, sha256: '8799e62282cf2e65f9e654427b713d6c049899229ddf2aa20a4c8413ef451607', subject: 'court plaque: "FOUNTAIN COURT"'},
  plaque_geese: {call: 418, sha256: '15f225c22107677fb4c94605b00bf4d10e98def36a37436b5af706daffb46777', subject: 'court plaque: "FLIGHT COURT" (the bronze geese)'},
  plaque_orrery: {call: 419, sha256: 'c9f194a43be981a7892e248da44657cfab542222a3fb02c9a31c5d36c6134c88', subject: 'court plaque: "ORRERY COURT"'},
};

// ---------- atlases: slot rects in atlas pixels (y down); `families` / `landmarks` = the exported piece lists ----------
// Thirteen 2:3 posters at 512 x 768 do not fit a 2048 atlas side, so the posters pack 5 x 3 at 408 x 612 (exact 2:3; two spare slots).
const POSTER_FAMILIES = {
  books: ['books'], outfitter: ['outfitter'], music: ['music1', 'music2'], hobby: ['hobby'], design: ['design'], garden: ['garden'],
  arcade: ['arcade'], cinema: ['cinema1', 'cinema2', 'cinema3'], science: ['science'], hockey: ['hockey'],
};
const POSTERS = ['cinema1', 'cinema2', 'cinema3', 'music1', 'music2', 'books', 'outfitter', 'science', 'arcade', 'hockey', 'hobby', 'design', 'garden'];
const PLAQUE_LANDMARKS = {clock: 'plaque_clock', dinosaur: 'plaque_dinosaur', 'fig-tree': 'plaque_fig_tree', fountain: 'plaque_fountain', geese: 'plaque_geese', orrery: 'plaque_orrery'};
const PLAQUES = Object.values(PLAQUE_LANDMARKS);
const PW = 408, PH = 612, QW = 512, QH = 341;
const ATLASES = [
  {key: 'posters', file: 'skyways-d-posters', width: 5 * PW, height: 3 * PH,
    use: `Skyways destination shops: thirteen posters (${PW} x ${PH} each, 2:3, a 5 x 3 grid, two spare slots), one or more per anchor-shop family`,
    slots: POSTERS.map((piece, i) => ({name: piece, piece, x: (i % 5) * PW, y: Math.floor(i / 5) * PH, w: PW, h: PH}))},
  {key: 'plaques', file: 'skyways-d-plaques', width: 3 * QW, height: 2 * QH,
    use: `Skyways landmark courts: six cast-bronze / enamel court plaques (${QW} x ${QH} each, 3:2, a 3 x 2 grid), one per landmark family`,
    slots: PLAQUES.map((piece, i) => ({name: piece, piece, x: (i % 3) * QW, y: Math.floor(i / 3) * QH, w: QW, h: QH}))},
];

// ---------- helpers ----------
/** The largest rect of `aspect` (w / h) inside the box (default: the whole srcW x srcH image), centred on focus (fractions of the box). */
function coverRect(srcW, srcH, aspect, focus = [0.5, 0.5], box = [0, 0, srcW, srcH]) {
  const [bx, by, bw, bh] = [box[0], box[1], box[2] - box[0], box[3] - box[1]];
  if (bx < 0 || by < 0 || bx + bw > srcW || by + bh > srcH || bw < 64 || bh < 64) fail(`crop box ${box} outside the ${srcW}x${srcH} source`);
  let w = bw, h = Math.round(bw / aspect);
  if (h > bh) { h = bh; w = Math.round(bh * aspect); }
  const x = bx + Math.min(bw - w, Math.max(0, Math.round(focus[0] * bw - w / 2)));
  const y = by + Math.min(bh - h, Math.max(0, Math.round(focus[1] * bh - h / 2)));
  return {x, y, w, h};
}
const r6 = v => Math.round(v * 1e6) / 1e6;
/** UV rect (three.js: v = 0 at the image bottom) of an atlas pixel rect, inset by half a texel. */
function uvOf(x, y, w, h, W, H) {
  return {u0: r6((x + 0.5) / W), v0: r6(1 - (y + h - 0.5) / H), u1: r6((x + w - 0.5) / W), v1: r6(1 - (y + 0.5) / H), aspect: r6(w / h)};
}

// ---------- ledger rows -> verified sources ----------
const rows = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const src = {};
for (const [name, s] of Object.entries(SOURCES)) {
  const results = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.n === s.call && (r.files ?? []).some(f => f.sha256 === s.sha256));
  if (results.length !== 1) fail(`${name}: expected one ledger result row for call ${s.call} with sha256 ${s.sha256}, found ${results.length}`);
  const res = results[0];
  if (res.rc !== 0 || res.files.length !== 1) fail(`${name}: call ${s.call} is not a clean single-image result (rc ${res.rc}, ${res.files.length} files)`);
  const intents = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.t < res.t);
  const intent = intents[intents.length - 1];
  if (!intent) fail(`${name}: no intent row before the result of call ${s.call}`);
  const file = res.files[0];
  const session = /generated_images\/([0-9a-f-]{36})\//.exec(file.src)?.[1];
  if (!session) fail(`${name}: no Codex session id in ${file.src}`);
  const buf = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(buf) !== s.sha256 || buf.length !== file.bytes) fail(`${name}: ${file.raw} does not match its ledger row`);
  const promptPath = path.join(GEN, 'prompts', intent.promptFile);
  const prompt = fs.readFileSync(promptPath, 'utf8').trim();
  if (sha(Buffer.from(prompt)) !== intent.promptSha256) fail(`${name}: ${intent.promptFile} differs from the prompt the ledger recorded`);
  const meta = await sharp(buf).metadata();
  src[name] = {...s, name, buf, meta, session, rawFile: path.basename(file.raw), rawBytes: buf.length, intentT: intent.t, resultT: res.t,
    seconds: res.seconds, promptFile: intent.promptFile, promptSha256: intent.promptSha256};
}

// ---------- build ----------
const outputs = [];
const tsAtlases = [];
for (const a of ATLASES) {
  const layers = [], pieces = {}, provPieces = [];
  for (const slot of a.slots) {
    const s = src[slot.piece] ?? fail(`${a.key}: unknown source ${slot.piece}`);
    const crop = coverRect(s.meta.width, s.meta.height, slot.w / slot.h, s.focus, s.box);
    const img = await sharp(s.buf).removeAlpha().toColourspace('srgb').extract({left: crop.x, top: crop.y, width: crop.w, height: crop.h})
      .resize(slot.w, slot.h, {kernel: 'lanczos3', fit: 'fill'}).png().toBuffer();
    layers.push({input: img, left: slot.x, top: slot.y});
    pieces[slot.name] = uvOf(slot.x, slot.y, slot.w, slot.h, a.width, a.height);
    provPieces.push({name: slot.name, subject: s.subject,
      codex: {generator: GENERATOR, ledgerCall: s.call, session: s.session, requested: s.intentT, finished: s.resultT, seconds: s.seconds},
      prompt: {file: s.promptFile, sha256: s.promptSha256},
      source: {file: s.rawFile, sha256: s.sha256, bytes: s.rawBytes, width: s.meta.width, height: s.meta.height},
      crop, placed: {x: slot.x, y: slot.y, w: slot.w, h: slot.h}});
  }
  const jpg = await sharp({create: {width: a.width, height: a.height, channels: 3, background: FILL}}).composite(layers)
    .toColourspace('srgb').jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const m = await sharp(jpg).metadata();
  if (m.width !== a.width || m.height !== a.height || m.format !== 'jpeg') fail(`${a.key}: bad atlas ${m.width}x${m.height} ${m.format}`);
  const rel = `${OUT_DIR_REL}/${a.file}.jpg`, provRel = `${PROV_DIR_REL}/${a.file}.json`;
  const prov = {schema: 'last-line-derivative/1', asset: a.file, task: TASK, lane: 'ART2D',
    status: "runtime derivative (crop / resize / atlas pack only) of ORIGINAL static artwork generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit art authorization for the Skyways destinations (no numerical image cap, user override); invented titles, bands, teams, societies and brand names; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
    use: a.use,
    rebuild: 'node tools/asset-pipeline/props/build-skyways-dest-art.mjs',
    rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-exec-<id>.png, prompts/art2d-<n>.txt} (private, outside Git)`,
    generator: GENERATOR,
    recipe: {crop: 'centred cover crop to the slot aspect (inside an optional per-piece source box)', resize: {kernel: 'lanczos3', fit: 'fill'}, colour: 'sRGB, alpha removed',
      pack: `atlas ${a.width}x${a.height}, empty area rgb(${FILL.r},${FILL.g},${FILL.b})`, encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
      uv: 'three.js convention (v = 0 at the image bottom), each rect inset by half a texel', tool: 'sharp (libvips) via tools/asset-pipeline/props/build-skyways-dest-art.mjs'},
    output: {url: rel, bytes: jpg.length, sha256: sha(jpg), width: a.width, height: a.height, format: 'jpeg'},
    pieces: provPieces};
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
  if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
  outputs.push({path: rel, buf: jpg}, {path: provRel, buf: provBuf});
  tsAtlases.push({key: a.key, url: rel, width: a.width, height: a.height, pieces});
}

// ---------- the generated module (three-free data) ----------
const fmtPiece = p => `{u0: ${p.u0}, v0: ${p.v0}, u1: ${p.u1}, v1: ${p.v1}, aspect: ${p.aspect}}`;
const q = n => `'${n}'`;
const ts = [
  `// GENERATED by tools/asset-pipeline/props/build-skyways-dest-art.mjs — do not edit (task ${TASK}, lane ART2D).`,
  "// The Skyways destinations' ORIGINAL Codex-generated flat artwork packed into JPEG atlases (crop / resize / pack only): thirteen shop",
  '// posters (one or more per anchor-shop family) and six cast-bronze / enamel court plaques (one per landmark family). Provenance',
  '// assets/derivatives/skyways-d-<atlas>.json. UVs: three.js convention (v = 0 at the image bottom, flipY textures), each rect inset by half',
  '// a texel; aspect = width / height.',
  "import type {SkywaysLandmarkFamily, SkywaysShopFamily} from '../gen/skyways/skywaysTypes';",
  'export interface SkywaysDestArtPiece { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number; readonly aspect: number }',
  'export interface SkywaysDestArtAtlas { readonly url: string; readonly width: number; readonly height: number; readonly pieces: Readonly<Record<string, SkywaysDestArtPiece>> }',
  'export const SKYWAYS_DEST_ART = {',
  ...tsAtlases.map(a => [`  ${a.key}: {url: '${a.url}', width: ${a.width}, height: ${a.height}, pieces: {`,
    ...Object.entries(a.pieces).map(([n, p]) => `    ${n}: ${fmtPiece(p)},`), '  }},'].join('\n')),
  '} as const satisfies Readonly<Record<string, SkywaysDestArtAtlas>>;',
  'export type SkywaysDestArtAtlasKey = keyof typeof SKYWAYS_DEST_ART;',
  'export type SkywaysDestPosterKey = keyof typeof SKYWAYS_DEST_ART.posters.pieces;',
  'export type SkywaysDestPlaqueKey = keyof typeof SKYWAYS_DEST_ART.plaques.pieces;',
  `export const SKYWAYS_DEST_POSTERS = [${POSTERS.map(q).join(', ')}] as const satisfies readonly SkywaysDestPosterKey[];`,
  `export const SKYWAYS_DEST_PLAQUES = [${PLAQUES.map(q).join(', ')}] as const satisfies readonly SkywaysDestPlaqueKey[];`,
  '/** The posters of each anchor-shop family (atlas `posters`). */',
  'export const SKYWAYS_DEST_POSTERS_BY_FAMILY = {',
  ...Object.entries(POSTER_FAMILIES).map(([f, ns]) => `  ${/^[a-z]+$/.test(f) ? f : q(f)}: [${ns.map(q).join(', ')}],`),
  '} as const satisfies Readonly<Record<SkywaysShopFamily, readonly SkywaysDestPosterKey[]>>;',
  '/** The court plaque of each landmark family (atlas `plaques`). */',
  'export const SKYWAYS_DEST_PLAQUE_BY_LANDMARK = {',
  ...Object.entries(PLAQUE_LANDMARKS).map(([f, n]) => `  ${/^[a-z]+$/.test(f) ? f : q(f)}: ${q(n)},`),
  '} as const satisfies Readonly<Record<SkywaysLandmarkFamily, SkywaysDestPlaqueKey>>;',
  '',
].join('\n');

// ---------- allowlist (this script's paths only) ----------
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
// Exact paths only: other Skyways lanes own their own skyways-* files (never touched here).
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

console.log(JSON.stringify({task: TASK, outputs: outputs.map(o => ({path: o.path, bytes: o.buf.length, sha256: sha(o.buf)})),
  atlasBytes: outputs.filter(o => o.path.endsWith('.jpg')).reduce((n, o) => n + o.buf.length, 0)}, null, 1));

if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === ts ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-skyways-dest-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);

fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), ts);
fs.writeFileSync(ALLOW, allowText);
console.log('build-skyways-dest-art: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
