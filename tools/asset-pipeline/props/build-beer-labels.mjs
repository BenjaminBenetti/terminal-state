// Task studio-market-bar-20261108-225231-01 (lane BEER): the runtime LABEL ATLAS of the market bar's five beers — Express Line Lager, Lucky
// Switch Pilsner, Ironclad Stout, Night Shift Porter, Second Supper Bock — from their Codex-generated ORIGINAL label images (one ledgered
// Codex native image_gen call per beer, owned Codex CLI; root CLAUDE.md "Textures — Codex for INITIAL sources": nothing hand-drawn, the
// label art and its lettering are the generated images). Processing only: resize (sharp lanczos3), packing into one atlas with
// edge-copied gutters (mip-safe), JPEG encoding — the build-market-textures.mjs recipe.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/market-bar-20261108-225231/beer/):
//   LABEL-LEDGER.jsonl (the fsynced intent + result row of every Codex call), raw/codex-<n>-label-<beer>-exec-<id>.png (byte-exact
//   outputs), prompts/label-<beer>.txt
// and writes deterministically:
//   game/public/assets/textures/market/beer-labels.jpg     sRGB JPEG (mozjpeg q85, 4:2:0, metadata stripped), 1024 x 1024:
//                                                          2 x 3 cells of 512 x 341, each label 500 x 333 (3:2) in the middle of its cell
//   game/public/assets/derivatives/beer-labels.json        ONE provenance record (per label: ledger call, Codex session, prompt / raw
//                                                          sha256s, recipe, its atlas rect; no prompt text, no URLs, no local paths)
//   game/src/assets/beerLabels.generated.ts                the url / bytes and every beer's label rect in UV (flipY: v up)
//   tools/release/public-inputs.json                       ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-beer-labels.mjs [--dry-run | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-market-bar-20261108-225231-01';
const TASK_REL = 'reference/tasks/market-bar-20261108-225231';
const PUB = path.join(root, 'game/public');
const OUT_REL = 'assets/textures/market/beer-labels.jpg';
const PROV_REL = 'assets/derivatives/beer-labels.json';
const TS_REL = 'game/src/assets/beerLabels.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const ATLAS = 1024;
const CELL = {w: 512, h: 341};
const LABEL = {w: 500, h: 333};
const PAPER = {r: 232, g: 220, b: 192}; // (the unused sixth cell: flat label-paper cream)
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-beer-labels: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'beer/LABEL-LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/beer (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'beer');

// ---------- the accepted Codex outputs (one ledgered call each; all five accepted at their first call) ----------
const SOURCES = {
  beer_lager: {call: 801, sha256: '1a4a9645cb76747a17c82e15d089f5f54a64e889c41676e2cb148500ebdf4256', cell: [0, 0],
    subject: 'EXPRESS LINE / LAGER: a vintage subway train rushing forward with speed lines; golden yellow, signal green and black on aged cream paper'},
  beer_pilsner: {call: 802, sha256: 'f917cf02aca3a26a21fdee86dfbb8996f2aee5531ca505b9a714fb4b4e4870a1', cell: [1, 0],
    subject: 'LUCKY SWITCH / PILSNER: a railway switch lever topped by a clover, wheat sprays; emerald green, gold and black on aged cream paper'},
  beer_stout: {call: 803, sha256: '4c5e906fd414b7a7f3d6b0158c33541c17275e7260d42d43197fa6b65e3827e1', cell: [0, 1],
    subject: 'IRONCLAD / STOUT: a riveted iron shield over two crossed railroad spikes; charcoal, rust copper and off-white on aged cream paper'},
  beer_porter: {call: 804, sha256: '7937a1da1b2a263744e1c2b122bee21b9402025b0d12c7c4aa8c1f60b339e668', cell: [1, 1],
    subject: 'NIGHT SHIFT / PORTER: a crescent moon over a brick tunnel mouth with a hanging lantern; navy, amber and black on aged cream paper'},
  beer_bock: {call: 805, sha256: 'fa2977abcb3cd63be2b945c7084ac3eb8bc1f2085243a8ecbb8cea43e4dd0db3', cell: [0, 2],
    subject: 'SECOND SUPPER / BOCK: a billy goat head over a crossed fork and knife and a loaf; brick red, dark brown and black on aged cream paper'},
};

const rows = fs.readFileSync(path.join(GEN, 'LABEL-LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const pad = {x: (CELL.w - LABEL.w) / 2, y: Math.floor((CELL.h - LABEL.h) / 2)};
const composites = [], records = {}, rects = {};
for (const [beer, s] of Object.entries(SOURCES)) {
  const results = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.n === s.call && r.status === 'ok' && (r.files ?? []).some(f => f.sha256 === s.sha256));
  if (results.length !== 1) fail(`${beer}: expected one ledger result row for call ${s.call} with sha256 ${s.sha256}, found ${results.length}`);
  const res = results[0];
  if (res.rc !== 0 || res.files.length !== 1) fail(`${beer}: call ${s.call} is not a clean single-image result`);
  const intent = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.t < res.t).pop();
  if (!intent) fail(`${beer}: no intent row before the result of call ${s.call}`);
  const file = res.files[0];
  if (!res.session || !file.src.includes(res.session)) fail(`${beer}: no Codex session id`);
  const raw = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(raw) !== s.sha256 || raw.length !== file.bytes) fail(`${beer}: ${file.raw} does not match its ledger row`);
  const prompt = fs.readFileSync(path.join(GEN, 'prompts', intent.promptFile), 'utf8').trim();
  if (sha(Buffer.from(prompt)) !== intent.promptSha256) fail(`${beer}: ${intent.promptFile} differs from the ledgered prompt`);
  const meta = await sharp(raw).metadata();
  // the label at its cell size, its edge pixels copied out into the cell's gutter (lower mips never pull a neighbour's colours in)
  const cell = await sharp(raw).removeAlpha().toColourspace('srgb').resize(LABEL.w, LABEL.h, {kernel: 'lanczos3', fit: 'fill'})
    .extend({left: pad.x, right: CELL.w - LABEL.w - pad.x, top: pad.y, bottom: CELL.h - LABEL.h - pad.y, extendWith: 'copy'}).png().toBuffer();
  const x0 = s.cell[0] * CELL.w, y0 = s.cell[1] * CELL.h;
  composites.push({input: cell, left: x0, top: y0});
  const r = {x: x0 + pad.x, y: y0 + pad.y, w: LABEL.w, h: LABEL.h};
  // UV (texture flipY: v = 0 at the image bottom): [u0, v0, u1, v1]
  rects[beer] = [r.x / ATLAS, 1 - (r.y + r.h) / ATLAS, (r.x + r.w) / ATLAS, 1 - r.y / ATLAS].map(v => Math.round(v * 1e6) / 1e6);
  records[beer] = {subject: s.subject,
    codex: {generator: GENERATOR, ledgerCall: s.call, session: res.session, requested: intent.t, finished: res.t, seconds: res.seconds},
    prompt: {file: intent.promptFile, sha256: intent.promptSha256},
    source: {file: path.basename(file.raw), sha256: s.sha256, bytes: raw.length, width: meta.width, height: meta.height},
    recipe: {resize: {width: LABEL.w, height: LABEL.h, kernel: 'lanczos3', fit: 'fill'}, gutter: {...pad, extendWith: 'copy'}, colour: 'sRGB, alpha removed'},
    atlasRect: {...r, uv: rects[beer]}};
}
const jpg = await sharp({create: {width: ATLAS, height: ATLAS, channels: 3, background: PAPER}}).composite(composites)
  .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
const m = await sharp(jpg).metadata();
if (m.width !== ATLAS || m.height !== ATLAS || m.format !== 'jpeg') fail('bad atlas output');

const prov = {schema: 'last-line-derivative/1', asset: 'beer-labels', task: TASK, lane: 'BEER',
  status: "runtime derivative (resize / atlas packing / JPEG only) of ORIGINAL beer-label images generated for this project with Codex native image_gen (owned Codex CLI) under the user's art authorization for the market bar's beers (Codex initial images: labels); provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  rebuild: 'node tools/asset-pipeline/props/build-beer-labels.mjs',
  rawStorage: `${TASK_REL}/beer/{LABEL-LEDGER.jsonl, raw/codex-<n>-label-<beer>-exec-<id>.png, prompts/label-<beer>.txt} (private, outside Git)`,
  generator: GENERATOR, tool: 'sharp (libvips) via tools/asset-pipeline/props/build-beer-labels.mjs',
  atlas: {url: OUT_REL, width: ATLAS, height: ATLAS, cell: CELL, label: LABEL, unusedCell: {fill: PAPER},
    encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'}, bytes: jpg.length, sha256: sha(jpg)},
  labels: records};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
const outputs = [{path: OUT_REL, buf: jpg}, {path: PROV_REL, buf: provBuf}];

const tsText = [
  `// GENERATED by tools/asset-pipeline/props/build-beer-labels.mjs — do not edit (task ${TASK}, lane BEER).`,
  "// The market bar's five beer labels: ORIGINAL Codex-generated label images packed into one atlas (resize / packing / JPEG only).",
  '// Provenance assets/derivatives/beer-labels.json. rect = the label in UV [u0, v0, u1, v1] (texture flipY: v up); aspect = width / height.',
  'export const BEER_LABEL_ATLAS = {',
  `  url: '${OUT_REL}', bytes: ${jpg.length}, aspect: ${Math.round(LABEL.w / LABEL.h * 1e4) / 1e4},`,
  '  rect: {',
  ...Object.entries(rects).map(([k, r]) => `    ${k}: [${r.join(', ')}],`),
  '  },',
  '} as const;',
  '',
].join('\n');

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';
console.log(JSON.stringify({task: TASK, outputs: outputs.map(o => ({path: o.path, bytes: o.buf.length, sha256: sha(o.buf)})), rects}, null, 1));
if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === tsText ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-beer-labels: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, path.dirname(OUT_REL)), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), tsText);
fs.writeFileSync(ALLOW, allowText);
console.log('build-beer-labels: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
