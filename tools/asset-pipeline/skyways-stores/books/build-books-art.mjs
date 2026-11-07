// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): runtime derivative of Paper Prairie Books' Codex-generated
// ORIGINAL flat artwork — the eight carved category signs (one sign sheet) and the two area rugs (one rug sheet) packed into one JPEG
// atlas. Root CLAUDE.md "Textures — Codex for INITIAL sources": each sheet is ONE Codex native image_gen call (owned Codex CLI, the
// lane's ledger); nothing hand-drawn. Processing only: crop each board / rug at its measured edge on the sheet (a background-difference
// mask: rows / columns of the sheet's flat charcoal backdrop), resize (sharp lanczos3, aspect kept), pack.
//
// Reads (never modifies) the private raw backup OUTSIDE Git (reference/tasks/skyways-rework-20261107-054512/shops/books/codex/:
// LEDGER.jsonl, raw/<tag>-<session>-exec-<id>.png, prompts/<tag>.txt) and writes deterministically:
//   game/public/assets/textures/skyways/stores/books/skyways-store-books-art.jpg   sRGB JPEG atlas (mozjpeg q85, 4:2:0, no metadata)
//   game/public/assets/derivatives/skyways-store-art-20261107.json           provenance (ledger rows, sessions, prompt + raw sha256s,
//                                                                                  crop / placement rects)
//   game/src/gen/skyways/stores/booksArt.generated.ts                              atlas url / size / per-piece UV rects (three.js
//                                                                                  convention: v = 0 at the image bottom; inset half a texel)
//   tools/release/public-inputs.json                                               ONLY this script's two public paths (sorted)
// Usage: node tools/asset-pipeline/skyways-stores/books/build-books-art.mjs [--dry-run | --check] [--task-dir=<raw backup folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {STORE_ART_PROV_REL, storeProvenanceBuffer} from '../storeProvenance.mjs'; // (primary, integration: one combined store-art provenance record)

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../../..');
const TASK = 'studio-alpha-skyways-shops-20261107-054512-01';
const TASK_REL = 'reference/tasks/skyways-rework-20261107-054512/shops/books/codex';
const PUB = path.join(root, 'game/public');
const ATLAS_REL = 'assets/textures/skyways/stores/books/skyways-store-books-art.jpg';
const PROV_REL = STORE_ART_PROV_REL;
const TS_REL = 'game/src/gen/skyways/stores/booksArt.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const W = 1024, H = 1024, QUALITY = 85, FILL = {r: 24, g: 24, b: 28};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run'), CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-books-art: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 6; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL} (the raw Codex outputs live outside Git; pass --task-dir=)`);
}
const DIR = taskDir();

// ---------- the accepted Codex outputs (one ledgered call each, both accepted at their first call: text checked letter by letter) ----------
const SHEETS = {
  'books-01-signs': {sha256: 'a5d55b1e432622ebc4e923e3a6e156043b28912956f05cc980076341a13b8362', grid: [2, 4],
    subject: 'sheet of eight carved walnut bookshop category signs, cream-and-gold serif lettering (invented shop signage)'},
  'books-02-rugs': {sha256: '825eeaf8ec4325b34213fcbefe8e71351bb5ce37a5245a8696d80c7956c4481c', grid: [2, 1],
    subject: 'two area rugs seen from above: a worn Persian-style reading-room rug, a children\'s prairie play rug'},
};
// pieces in sheet reading order (left to right, top to bottom) -> atlas slots
const PIECES = {
  'books-01-signs': ['fiction', 'local-history', 'maps-travel', 'childrens', 'rare-books', 'poetry', 'prairie-authors', 'new-notable'],
  'books-02-rugs': ['rug-reading', 'rug-children'],
};
// atlas slots: the signs 512 px wide in 2 columns x 4 rows of 136 px; the rugs 512 x 341 side by side below them
const SLOT = {sign: {w: 512, row: 136, y0: 0}, rug: {w: 512, h: 341, y0: 560}};

const ledger = fs.readFileSync(path.join(DIR, 'LEDGER.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

/** The boards / rugs on a sheet: bands of rows, then columns, whose pixels differ from the backdrop (sampled at the corner). */
async function measure(file, [nc, nr]) {
  const {data, info} = await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const w = info.width, h = info.height, bg = [data[0], data[1], data[2]];
  const on = (x, y) => { const i = (y * w + x) * 3; return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40; };
  const bands = (arr, thr) => { const out = []; let s = -1; arr.forEach((v, i) => { if (v > thr && s < 0) s = i; if (v <= thr && s >= 0) { out.push([s, i]); s = -1; } }); if (s >= 0) out.push([s, arr.length]); return out; };
  const rows = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (on(x, y)) n++; rows.push(n); }
  const rb = bands(rows, w * 0.1);
  if (rb.length !== nr) fail(`${path.basename(file)}: ${rb.length} row bands, expected ${nr}`);
  const boxes = [];
  for (const [y0, y1] of rb) {
    const cols = [];
    for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y < y1; y++) if (on(x, y)) n++; cols.push(n); }
    const cb = bands(cols, (y1 - y0) * 0.3);
    if (cb.length !== nc) fail(`${path.basename(file)}: band ${y0}-${y1} has ${cb.length} columns, expected ${nc}`);
    for (const [x0, x1] of cb) boxes.push({x: x0 + 1, y: y0 + 1, w: x1 - x0 - 2, h: y1 - y0 - 2}); // (1 px in: off the anti-aliased edge)
  }
  return {width: w, height: h, boxes};
}

const sources = [], composites = [], pieces = {};
for (const [tag, s] of Object.entries(SHEETS)) {
  const res = ledger.find(r => r.event === 'result' && r.tag === tag), intent = ledger.find(r => r.event === 'intent' && r.tag === tag);
  if (!res || !intent || res.exit !== 0 || res.outputs.length !== 1) fail(`${tag}: no single accepted ledger result`);
  const out = res.outputs[0], file = path.join(DIR, out.raw), buf = fs.readFileSync(file);
  if (sha(buf) !== s.sha256 || out.sha256 !== s.sha256) fail(`${tag}: raw sha256 mismatch`);
  const prompt = fs.readFileSync(path.join(DIR, 'prompts', intent.prompt_file), 'utf8').trim();
  if (sha(Buffer.from(fs.readFileSync(path.join(DIR, 'prompts', intent.prompt_file)))) !== intent.prompt_sha256) fail(`${tag}: prompt sha256 mismatch`);
  const m = await measure(file, s.grid);
  const names = PIECES[tag], placed = [];
  for (let k = 0; k < names.length; k++) {
    const b = m.boxes[k], isRug = tag === 'books-02-rugs';
    const pw = isRug ? SLOT.rug.w : SLOT.sign.w, ph = isRug ? SLOT.rug.h : Math.round(SLOT.sign.w * b.h / b.w);
    const px = isRug ? k * SLOT.rug.w : (k % 2) * SLOT.sign.w, py = isRug ? SLOT.rug.y0 : SLOT.sign.y0 + Math.floor(k / 2) * SLOT.sign.row;
    if (!isRug && ph > SLOT.sign.row) fail(`${names[k]}: ${ph} px tall, slot ${SLOT.sign.row}`);
    const tile = await sharp(buf).extract({left: b.x, top: b.y, width: b.w, height: b.h}).removeAlpha().resize(pw, ph, {kernel: 'lanczos3', fit: 'fill'}).toBuffer();
    composites.push({input: tile, left: px, top: py});
    // UVs (three.js: v = 0 at the bottom), inset half a texel; aspect = the source box's (kept: the fill resize is within 0.5 %)
    pieces[names[k]] = {u0: +((px + 0.5) / W).toFixed(6), v0: +(1 - (py + ph - 0.5) / H).toFixed(6), u1: +((px + pw - 0.5) / W).toFixed(6), v1: +(1 - (py + 0.5) / H).toFixed(6),
      aspect: +(b.w / b.h).toFixed(4)};
    placed.push({piece: names[k], source: [b.x, b.y, b.w, b.h], atlas: [px, py, pw, ph]});
  }
  sources.push({id: tag, subject: s.subject, source: {file: out.raw, sha256: s.sha256, bytes: buf.length, width: m.width, height: m.height},
    codex: {generator: GENERATOR, session: out.session, nativeOutput: path.basename(out.src), nativeSha256Matches: true, exit: res.exit, launched: intent.at, finished: res.at},
    prompt, promptSha256: intent.prompt_sha256, pieces: placed});
}

const atlas = await sharp({create: {width: W, height: H, channels: 3, background: FILL}}).composite(composites)
  .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();

const prov = {
  schema: 'last-line-derivative/1',
  asset: 'skyways-store-books-art-20261107',
  task: TASK,
  lane: 'STORE-BOOKS (Skyways major store: Paper Prairie Books)',
  status: 'runtime derivative (crop / resize / atlas pack only) of ORIGINAL static artwork generated for this project with Codex native image_gen (owned Codex CLI) under the user\'s explicit art authorization for the Skyways major stores (no numerical cap; 2 calls, both accepted at the first attempt); invented shop signage; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  use: 'Paper Prairie Books (Skyways, layout version 3): the eight category signs on the bookcases\' headers / the feature tables (skyBooksSign variants) and the two area rugs (skyBooksRug variants), drawn by game/src/world/skywaysStoreBooks.ts',
  rebuild: 'node tools/asset-pipeline/skyways-stores/books/build-books-art.mjs',
  rawStorage: `${TASK_REL}/{LEDGER.jsonl, raw/<tag>-<session>-exec-<id>.png, prompts/<tag>.txt} (private raw backup, outside Git)`,
  generator: GENERATOR,
  recipe: {
    crop: 'each board / rug at its measured edge on the sheet (backdrop-difference mask: row bands, then column bands; 1 px inset)',
    resize: {kernel: 'lanczos3', fit: 'fill (the box\'s own aspect kept: signs 512 px wide, rugs 512 x 341)'},
    colour: 'sRGB, alpha removed',
    pack: `atlas ${W}x${H}, empty area rgb(${FILL.r},${FILL.g},${FILL.b})`,
    encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    uv: 'three.js convention (v = 0 at the image bottom), each rect inset by half a texel',
    tool: 'sharp (libvips) via tools/asset-pipeline/skyways-stores/books/build-books-art.mjs',
  },
  output: {path: ATLAS_REL, bytes: atlas.length, sha256: sha(atlas), width: W, height: H},
  sources,
};
const provBuf = storeProvenanceBuffer('books', prov);

const q = s => `'${s}'`;
const ts = [
  `// GENERATED by tools/asset-pipeline/skyways-stores/books/build-books-art.mjs — do not edit (task ${TASK}, lane STORE-BOOKS).`,
  '// Paper Prairie Books\' ORIGINAL Codex-generated flat artwork (the category signs, the rugs) packed into one JPEG atlas (crop / resize /',
  `// pack only). Provenance ${PROV_REL}. UVs: three.js convention (v = 0 at the image bottom, flipY textures), inset half a texel;`,
  '// aspect = the source box\'s width / height.',
  'export interface BooksArtPiece { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number; readonly aspect: number }',
  'export const BOOKS_ART = {',
  `  url: ${q(ATLAS_REL)}, width: ${W}, height: ${H},`,
  '  pieces: {',
  ...Object.entries(pieces).map(([k, r]) => `    ${q(k)}: {u0: ${r.u0}, v0: ${r.v0}, u1: ${r.u1}, v1: ${r.v1}, aspect: ${r.aspect}},`),
  '  },',
  '} as const;',
  'export type BooksArtKey = keyof typeof BOOKS_ART.pieces;',
  '',
].join('\n');

const outputs = [{path: ATLAS_REL, buf: atlas}, {path: PROV_REL, buf: provBuf}];
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

console.log(JSON.stringify({task: TASK, outputs: outputs.map(o => ({path: o.path, bytes: o.buf.length, sha256: sha(o.buf)}))}, null, 1));
if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === ts ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-books-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
for (const o of outputs) { fs.mkdirSync(path.dirname(path.join(PUB, o.path)), {recursive: true}); fs.writeFileSync(path.join(PUB, o.path), o.buf); }
fs.writeFileSync(path.join(root, TS_REL), ts);
fs.writeFileSync(ALLOW, allowText);
console.log('build-books-art: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
