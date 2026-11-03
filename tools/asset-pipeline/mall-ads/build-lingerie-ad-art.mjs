// Task studio-beta-mall-lingerie-store-polish-20261103-045922-01 (user: "the art work in the store for adds is the regular female clothing
// store add work, this doesn't make sense, use codex to generate appropriate adds for this sort of store"): runtime derivatives of the
// FOUR Codex-generated lingerie-boutique ad artworks (root CLAUDE.md "Textures — Codex for INITIAL sources"; product-only compositions made
// with the user's own garment reference PNGs attached as design references; no text — the brand / headline text stays code-driven,
// game/src/world/mallAds.ts). A sibling of build-ad-art.mjs with its OWN output folder (that script drops other files in its folder).
//
// Reads (never modifies) the primary's raw masters kept OUTSIDE Git in reference/tasks/mall-lingerie-store-polish-20261103-045922/codex/:
//   ad-lingerie-<theme>/ad-lingerie-<theme>-original.png  the byte-exact Codex native image_gen output (1254 x 1254 RGB PNG, no text)
//   ad-lingerie-<theme>/receipt.json / prompt.txt / inputs.txt (the attached user references)   SOURCES-SHA256.txt (accepted set)
// and writes deterministically:
//   game/public/assets/textures/mall/ads-lingerie/ad-lingerie-<theme>.jpg  512 x 512 sRGB JPEG (sharp lanczos3, mozjpeg q85, 4:2:0)
//   game/public/assets/derivatives/mall-lingerie-ad-art-20261103.json      provenance (no URLs, no local absolute paths, no secrets)
//   game/public/assets/CREDITS.md (the marked section) and tools/release/public-inputs.json (ONLY this script's paths + CREDITS.md)
//
// Usage: node tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs [--dry-run | --check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-mall-lingerie-store-polish-20261103-045922-01';
const TASK_DIR = 'reference/tasks/mall-lingerie-store-polish-20261103-045922';
const CODEX = path.join(root, TASK_DIR, 'codex');
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/mall/ads-lingerie';
const PROV_REL = 'assets/derivatives/mall-lingerie-ad-art-20261103.json';
const CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_BEGIN = '<!-- BEGIN mall-lingerie-ad-art-20261103 (build-lingerie-ad-art.mjs) -->';
const CREDITS_END = '<!-- END mall-lingerie-ad-art-20261103 -->';
/** The accepted set (game/src/world/mallAdArt.ts AD_ART_IDS, same order) and a short subject line per source for CREDITS. */
const SOURCES = [
  ['ad-lingerie-flatlay', 'flat-lay of the emerald longline lace set and the black balconette lace set on blush satin (user designs 9gPhXy5tx6G6iW_0 / M52skrui8zNLGE_0)'],
  ['ad-lingerie-dressform', 'the plum lace strapless bustier with suspenders and brief on a vintage dress form (user design 9gPhXy5tx6G6iW_1)'],
  ['ad-lingerie-hangers', 'the crimson plunge bra + garter set and the ivory bralette + garter set on satin hangers (user designs M52skrui8zNLGE_1 / _2)'],
  ['ad-lingerie-giftbox', 'the blush lace plunge bodysuit folded in a ribboned gift box (user design 9gPhXy5tx6G6iW_2)'],
];
const SIZE = 512, QUALITY = 85;
const RECIPE = {resize: {width: SIZE, height: SIZE, fit: 'fill (square source: aspect kept, nothing cropped)', kernel: 'lanczos3'},
  colour: 'sRGB, alpha none', encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
  tool: 'sharp (libvips) via tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs'};

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-lingerie-ad-art: ${m}`); process.exit(1); };
const outRelOf = id => `${OUT_DIR_REL}/${id}.jpg`;

// ---------- sources: accepted-set hashes, receipts, prompts ----------
const sumsFile = path.join(CODEX, 'SOURCES-SHA256.txt');
if (!fs.existsSync(sumsFile)) fail(`missing ${path.relative(root, sumsFile)} (raw masters live outside Git; this script needs the task folder)`);
const accepted = new Map(fs.readFileSync(sumsFile, 'utf8').split('\n').filter(Boolean).map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const sources = [];
for (const [id, subject] of SOURCES) {
  const dir = path.join(CODEX, id), file = `${id}/${id}-original.png`;
  const png = path.join(CODEX, file), rec = path.join(dir, 'receipt.json'), prm = path.join(dir, 'prompt.txt');
  for (const f of [png, rec, prm]) if (!fs.existsSync(f)) fail(`${id}: missing ${path.relative(root, f)}`);
  const buf = fs.readFileSync(png), r = JSON.parse(fs.readFileSync(rec, 'utf8')), prompt = fs.readFileSync(prm, 'utf8');
  const h = sha(buf);
  if (accepted.get(file) !== h) fail(`${id}: sha256 ${h} is not the accepted SOURCES-SHA256.txt hash ${accepted.get(file)}`);
  if (r.id !== id || r.sha256 !== h || r.bytes !== buf.length) fail(`${id}: receipt.json does not describe this file`);
  if (String(r.codexExit) !== '0' || r.nativeSha256Matches !== true || !r.codexThreadId) fail(`${id}: receipt is not a clean Codex result (exit ${r.codexExit}, native match ${r.nativeSha256Matches})`);
  if (r.prompt !== prompt) fail(`${id}: receipt prompt differs from prompt.txt`);
  if (fs.existsSync(path.join(dir, 'codex-blocker.txt'))) fail(`${id}: a Codex blocker is recorded`);
  const meta = await sharp(buf).metadata();
  if (meta.width !== r.width || meta.height !== r.height || meta.width !== meta.height) fail(`${id}: unexpected dims ${meta.width}x${meta.height}`);
  const inputs = fs.readFileSync(path.join(dir, 'inputs.txt'), 'utf8').split('\n').filter(Boolean)
    .map(f => ({file: path.basename(f), sha256: sha(fs.readFileSync(f)), note: "the user's own garment reference (private, not shipped)"}));
  sources.push({id, subject, file, buf, r, prompt, meta, inputs});
}

// ---------- derivatives ----------
const outputs = [];
for (const s of sources) {
  const jpg = await sharp(s.buf).removeAlpha().toColourspace('srgb').resize(SIZE, SIZE, {kernel: 'lanczos3', fit: 'fill'})
    .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const m = await sharp(jpg).metadata();
  if (m.width !== SIZE || m.height !== SIZE || m.format !== 'jpeg') fail(`${s.id}: bad derivative ${m.width}x${m.height} ${m.format}`);
  outputs.push({s, jpg, rel: outRelOf(s.id)});
}

// ---------- provenance ----------
const prov = {schema: 'last-line-derivative/1', asset: 'mall-lingerie-ad-art-20261103', task: TASK, lane: 'primary (lingerie store polish)',
  status: "runtime derivatives of FOUR static lingerie-boutique ad artworks generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit authorization via Main (\"use codex to generate appropriate adds for this sort of store\"; 4 accepted of 4 attempts, cap 8), each made with the user's own garment reference PNG(s) attached as design references (listed per file by name + sha256; the references stay private); product-only, no people; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  use: 'game/src/world/mallAds.ts adTexture / drawMenu: the art is cover-cropped under the code-driven fictional brand, headline, price roundel, menu lines and aging overlay (dynamic text, exempt per root CLAUDE.md)',
  rebuild: 'node tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs',
  rawStorage: `${TASK_DIR}/codex/ad-lingerie-<theme>/{ad-lingerie-<theme>-original.png, receipt.json, prompt.txt, inputs.txt, codex-events.jsonl} + SOURCES-SHA256.txt + ATTEMPTS.jsonl (read-only raw masters, outside Git)`,
  generator: 'Codex native image_gen (owned Codex CLI)',
  recipe: RECIPE,
  files: outputs.map(({s, jpg, rel}) => ({id: s.id, subject: s.subject,
    source: {file: s.file, sha256: s.r.sha256, bytes: s.r.bytes, width: s.r.width, height: s.r.height, channels: s.r.channels, hasAlpha: s.r.hasAlpha},
    codex: {generator: 'Codex native image_gen (owned Codex CLI)', receiptGenerator: s.r.generator, threadId: s.r.codexThreadId,
      nativeOutput: path.basename(s.r.nativeOutput ?? ''), nativeSha256Matches: s.r.nativeSha256Matches, exit: Number(s.r.codexExit), launched: s.r.launched, finished: s.r.finished},
    prompt: s.prompt,
    designReferences: s.inputs,
    output: {url: rel, bytes: jpg.length, sha256: sha(jpg), width: SIZE, height: SIZE, format: 'jpeg'}}))};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{
  const t = provBuf.toString();
  const hit = t.match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/).{0,20}/i);
  if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
}

// ---------- CREDITS ----------
const credPath = path.join(PUB, CREDITS_REL);
const credSrc = fs.readFileSync(credPath, 'utf8');
const credSection = [CREDITS_BEGIN, '## Mall lingerie boutique: advertising artwork', '',
  `Generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool) under the user's explicit authorization (4 images, task ${TASK}), each made with the user's own lingerie design reference photos attached; runtime derivatives (512 px JPEG, resize + format conversion only) built by \`tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs\` (provenance with prompts, Codex thread ids and source / reference hashes: \`${PROV_REL}\`). Product-only and unbranded; the fictional brand names and headlines drawn over them in game are generated at runtime. Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters and the user references are kept outside Git.`, '',
  ...outputs.map(({s, rel}) => `- \`${rel}\` — ${s.subject} (Codex thread ${s.r.codexThreadId})`), CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`;

// ---------- allowlist (this script's paths + CREDITS.md) ----------
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const files = [...outputs.map(o => ({path: o.rel, buf: o.jpg})), {path: PROV_REL, buf: provBuf}, {path: CREDITS_REL, buf: Buffer.from(credNext)}];
const mine = new Set(files.map(f => f.path));
const stale = allow.files.filter(f => f.path.startsWith(`${OUT_DIR_REL}/`) && !mine.has(f.path)).map(f => f.path);
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path) && !stale.includes(f.path)), ...files.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

const report = {task: TASK, outputs: outputs.map(o => ({id: o.s.id, url: o.rel, bytes: o.jpg.length, sha256: sha(o.jpg), sourceSha256: o.s.r.sha256, thread: o.s.r.codexThreadId})),
  totalBytes: outputs.reduce((n, o) => n + o.jpg.length, 0), provenance: {url: PROV_REL, bytes: provBuf.length}, staleDropped: stale};
console.log(JSON.stringify(report, null, 1));

if (CHECK) {
  const diff = [...files.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-lingerie-ad-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);

fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.rel), o.jpg);
for (const p of stale) fs.rmSync(path.join(PUB, p), {force: true});
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);
fs.writeFileSync(credPath, credNext);
fs.writeFileSync(ALLOW, allowText);
console.log('build-lingerie-ad-art: wrote', outputs.length, 'textures,', PROV_REL, CREDITS_REL, 'tools/release/public-inputs.json');
