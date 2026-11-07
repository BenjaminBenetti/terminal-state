// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE): runtime derivative of BIG SKY WONDERS' Codex-generated
// ORIGINAL wall art — the star-map mural, the periodic-table-style chart and the three kit posters (chemistry set / crystal growing /
// robot kit, generated as ONE triptych and split at its measured gutters). Root CLAUDE.md "Textures — Codex for INITIAL sources": every
// source is one Codex native image_gen call (owned Codex CLI, lane ledger); nothing hand-drawn. Processing only: crop / resize (sharp
// lanczos3) / pack into one JPEG atlas.
//
// Reads (never modifies) the lane's raw backup kept OUTSIDE Git
// (reference/tasks/skyways-rework-20261107-054512/shops/science/codex/<job>/: the byte-exact Codex PNG, prompt.txt, receipt.json with
// its sha256 / Codex session id, the session rollout) and writes deterministically:
//   game/public/assets/textures/skyways/stores/science/science-art.jpg   2048 x 2048 sRGB JPEG atlas (mozjpeg q85, 4:2:0, no metadata);
//                                                                          level-only by path (assets/levelAssets.ts skyways textures rule)
//   game/public/assets/derivatives/skyways-store-science-art-20261107.json  provenance (session ids, prompt + raw sha256s, crop / pack
//                                                                          rects; prompt text included, no URLs, no local paths, no secrets)
//   game/src/gen/skyways/stores/scienceArt.generated.ts                   the atlas url / size and per-piece UV rects (three.js: v = 0 at
//                                                                          the bottom; each rect inset by half a texel)
//   (--allowlist) tools/release/public-inputs.json                        ONLY this script's public paths (kept for a separate commit)
//
// Usage: node tools/asset-pipeline/skyways-stores/science/build-science-art.mjs [--dry-run | --check] [--allowlist] [--raw-dir=<raw backup>]
// (--raw-dir: the raw backup folder when the checkout has no reference/ mount, e.g. a git worktree)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../../..');
const TASK = 'studio-alpha-skyways-shops-20261107-054512-01';
const LANE = 'STORE-SCIENCE';
const RAW_REL = 'reference/tasks/skyways-rework-20261107-054512/shops/science/codex';
const PUB = path.join(root, 'game/public');
const ATLAS_REL = 'assets/textures/skyways/stores/science/science-art.jpg';
const PROV_REL = 'assets/derivatives/skyways-store-science-art-20261107.json';
const TS_REL = 'game/src/gen/skyways/stores/scienceArt.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SIZE = 2048, QUALITY = 85, FILL = {r: 16, g: 24, b: 42};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';
const argv = process.argv.slice(2), args = new Set(argv);
const RAW_DIR = argv.find(a => a.startsWith('--raw-dir='))?.slice('--raw-dir='.length) ?? path.join(root, RAW_REL);
const DRY = args.has('--dry-run'), CHECK = args.has('--check'), ALLOWLIST = args.has('--allowlist');
const fail = m => { console.error('build-science-art:', m); process.exit(1); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/**
 * The pieces: source job, crop rect in the source (px; the triptych's panels inside their measured off-white gutters: panel 1 x 9..499,
 * 2 x 523..1013, 3 x 1037..1527, all y 8..1015, cropped 2 px inside), the size it is packed at and its atlas spot (8 px gaps).
 */
const PIECES = [
  {id: 'starMap', job: 'star-map-mural', subject: 'star chart of the northern sky (navy, gold constellations, Milky Way, moon phases)', crop: [0, 0, 1536, 1024], size: [1536, 1024], at: [0, 0]},
  {id: 'chemistry', job: 'kit-posters', subject: 'kit poster: CHEMISTRY SET (triptych panel 1)', crop: [11, 10, 487, 1004], size: [487, 1004], at: [1552, 0]},
  {id: 'chart', job: 'periodic-chart', subject: 'periodic-table-style classroom chart', crop: [0, 0, 1536, 1024], size: [1024, 683], at: [0, 1040]},
  {id: 'crystals', job: 'kit-posters', subject: 'kit poster: GROW CRYSTALS (triptych panel 2)', crop: [525, 10, 487, 1004], size: [487, 1004], at: [1040, 1040]},
  {id: 'robot', job: 'kit-posters', subject: 'kit poster: BUILD A ROBOT (triptych panel 3)', crop: [1039, 10, 487, 1004], size: [487, 1004], at: [1544, 1040]},
];

// ---------- sources (verified against their receipts) ----------
const sources = new Map();
for (const job of [...new Set(PIECES.map(p => p.job))]) {
  const dir = path.join(RAW_DIR, job);
  if (!fs.existsSync(dir)) fail(`missing raw backup ${RAW_REL}/${job}`);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  if (receipt.exit !== 0 || receipt.files?.length !== 1) fail(`${job}: receipt is not one successful image`);
  const f = receipt.files[0], file = path.basename(f.raw), buf = fs.readFileSync(path.join(dir, file));
  if (sha(buf) !== f.sha256) fail(`${job}: raw sha256 differs from its receipt`);
  const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
  const meta = await sharp(buf).metadata();
  const rollout = receipt.rollouts?.[0] ?? null;
  sources.set(job, {job, file, buf, sha256: f.sha256, bytes: buf.length, width: meta.width, height: meta.height, channels: meta.channels, session: receipt.sessions?.[0] ?? null,
    nativeOutput: path.basename(f.src), rollout, prompt, promptSha256: sha(Buffer.from(prompt))});
}

// ---------- the atlas ----------
const layers = [];
for (const p of PIECES) {
  const s = sources.get(p.job), [x, y, w, h] = p.crop;
  if (x + w > s.width || y + h > s.height) fail(`${p.id}: crop outside its ${s.width}x${s.height} source`);
  const img = await sharp(s.buf).extract({left: x, top: y, width: w, height: h}).resize(p.size[0], p.size[1], {kernel: 'lanczos3', fit: 'fill'}).removeAlpha().toBuffer();
  if (p.at[0] + p.size[0] > SIZE || p.at[1] + p.size[1] > SIZE) fail(`${p.id}: outside the atlas`);
  layers.push({input: img, left: p.at[0], top: p.at[1]});
}
for (let i = 0; i < PIECES.length; i++) for (let j = i + 1; j < PIECES.length; j++) {
  const a = PIECES[i], b = PIECES[j];
  if (a.at[0] < b.at[0] + b.size[0] && b.at[0] < a.at[0] + a.size[0] && a.at[1] < b.at[1] + b.size[1] && b.at[1] < a.at[1] + a.size[1]) fail(`${a.id} / ${b.id} overlap`);
}
const atlas = await sharp({create: {width: SIZE, height: SIZE, channels: 3, background: FILL}}).composite(layers)
  .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();

const r6 = v => Math.round(v * 1e6) / 1e6;
const uv = p => {
  const [x, y] = p.at, [w, h] = p.size, half = 0.5;
  return {u0: r6((x + half) / SIZE), v0: r6(1 - (y + h - half) / SIZE), u1: r6((x + w - half) / SIZE), v1: r6(1 - (y + half) / SIZE), aspect: r6(w / h)};
};

// ---------- provenance ----------
const prov = {
  schema: 'last-line-derivative/1',
  asset: 'skyways-store-science-art-20261107',
  task: TASK,
  lane: LANE,
  status: 'runtime derivative of five pieces of static wall art cut from THREE images generated for this project with Codex native image_gen (owned Codex CLI) under the store lanes\' Codex authorization (task studio-alpha-skyways-shops-20261107-054512-01: "Codex image-gen ... for the stores\' wall / sign / cover art", no numerical cap; 3 calls, 3 accepted); provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  use: 'game/src/world/skywaysStoreScienceArt.ts: the art faces of the Big Sky Wonders wall-art kinds (gen/skyways/stores/kinds/science.ts skySciStarMap / skySciChart / skySciPoster) in Skyways layout version >= 3',
  rebuild: 'node tools/asset-pipeline/skyways-stores/science/build-science-art.mjs',
  rawStorage: `${RAW_REL}/<job>/{<session>-exec-<id>.png, prompt.txt, instruction.txt, receipt.json, rollout-*.jsonl, last.txt} + ledger.jsonl (raw backup outside Git; never overwritten)`,
  generator: GENERATOR,
  recipe: {
    crop: 'extract (px) per piece: the triptych split inside its measured off-white gutters; the mural and the chart whole',
    resize: {kernel: 'lanczos3', fit: 'fill (aspect kept: target sizes match the crops / a uniform 2/3 for the chart)'},
    pack: {width: SIZE, height: SIZE, fill: '#10182a', gap: '>= 8 px', uv: 'three.js (v = 0 at the bottom), inset half a texel'},
    colour: 'sRGB, alpha none',
    encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    tool: 'sharp (libvips)',
  },
  sources: [...sources.values()].map(s => ({job: s.job, source: {file: s.file, sha256: s.sha256, bytes: s.bytes, width: s.width, height: s.height, channels: s.channels},
    codex: {generator: GENERATOR, session: s.session, nativeOutput: s.nativeOutput, rollout: s.rollout}, promptSha256: s.promptSha256, prompt: s.prompt.trim()})),
  pieces: PIECES.map(p => ({id: p.id, subject: p.subject, job: p.job, crop: p.crop, packedSize: p.size, packedAt: p.at, uv: uv(p)})),
  output: {url: ATLAS_REL, bytes: atlas.length, sha256: sha(atlas), width: SIZE, height: SIZE, format: 'jpeg'},
};
const provText = JSON.stringify(prov, null, 1) + '\n';

// ---------- the generated table ----------
const ts = [
  `// GENERATED by tools/asset-pipeline/skyways-stores/science/build-science-art.mjs — do not edit (task ${TASK}, lane ${LANE}).`,
  '// Big Sky Wonders\' ORIGINAL Codex-generated wall art packed into one JPEG atlas (crop / resize / pack only): the star-map mural, the',
  '// periodic-table-style chart and the three kit posters. Provenance assets/derivatives/skyways-store-science-art-20261107.json. UVs: three.js',
  '// convention (v = 0 at the image bottom, flipY textures), each rect inset by half a texel; aspect = width / height.',
  'export interface ScienceArtPiece { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number; readonly aspect: number }',
  `export const SCIENCE_ART = {url: '${ATLAS_REL}', width: ${SIZE}, height: ${SIZE}, pieces: {`,
  ...PIECES.map(p => { const r = uv(p); return `  ${p.id}: {u0: ${r.u0}, v0: ${r.v0}, u1: ${r.u1}, v1: ${r.v1}, aspect: ${r.aspect}},`; }),
  '}} as const;',
  'export type ScienceArtPieceKey = keyof typeof SCIENCE_ART.pieces;',
  '',
].join('\n');

// ---------- allowlist (this script's public paths only) ----------
const outputs = [{path: ATLAS_REL, buf: atlas}, {path: PROV_REL, buf: Buffer.from(provText)}];
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const allowText = JSON.stringify({...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))}, null, 2) + '\n';

console.log(JSON.stringify({task: TASK, lane: LANE, outputs: outputs.map(o => ({path: o.path, bytes: o.buf.length, sha256: sha(o.buf)}))}, null, 1));
if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === ts ? [] : [TS_REL]),
    ...(ALLOWLIST && fs.readFileSync(ALLOW, 'utf8') !== allowText ? ['tools/release/public-inputs.json'] : [])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-science-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.dirname(path.join(PUB, ATLAS_REL)), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), ts);
if (ALLOWLIST) fs.writeFileSync(ALLOW, allowText);
console.log('build-science-art: wrote', outputs.map(o => o.path).join(', '), TS_REL, ALLOWLIST ? 'tools/release/public-inputs.json' : '(allowlist untouched: --allowlist)');
