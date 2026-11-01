// Task studio-beta-mall-round4-20261101-01 (Studio Beta Mall round 4, lane ADS — user: "use codex to produce images for the adds, not
// draw them by hand :P"): runtime derivatives of the EIGHT Codex-generated mall ad artworks (root CLAUDE.md "Textures — Codex generates
// new static artwork": the static art comes from Codex image generation; the per-mall brand / headline / price / menu text and the aging
// stay code-driven over it, game/src/world/mallAds.ts).
//
// Reads (never modifies) the primary's raw masters kept OUTSIDE Git in reference/tasks/mall-round4-20261101/codex/:
//   ad-<theme>/ad-<theme>-original.png  the byte-exact Codex native image_gen output (1254 x 1254 RGB PNG, no text)
//   ad-<theme>/receipt.json             sha256 / dims / Codex thread id / native output path / exit code (record-image.mjs)
//   ad-<theme>/prompt.txt               the exact prompt
//   SOURCES-SHA256.txt                  the primary's accepted-set hashes (every source must match it AND its receipt)
// and writes deterministically:
//   game/public/assets/textures/mall/ads/ad-<theme>.jpg   512 x 512 sRGB JPEG (sharp lanczos3 resize, mozjpeg q85, 4:2:0, no metadata);
//                                                         level-only by path (game/src/assets/levelAssets.ts mall rule: assets/textures/mall/**)
//   game/public/assets/derivatives/mall-ad-art-20261101.json  provenance (no URLs, no local absolute paths, no secrets)
//   game/public/assets/CREDITS.md                         the marked section below
//   tools/release/public-inputs.json                      ONLY this script's paths (+ CREDITS.md, whose bytes change) added / updated
//
// Processing only (crop-free resize + format conversion): no drawing, no retouching, no generated substitute. Re-run after any other
// lane edits CREDITS.md so its allowlist hash follows (idempotent: same inputs -> same bytes).
//
// Usage:
//   node tools/asset-pipeline/mall-ads/build-ad-art.mjs            build + write
//   node tools/asset-pipeline/mall-ads/build-ad-art.mjs --dry-run  verify sources / receipts and report; write NOTHING
//   node tools/asset-pipeline/mall-ads/build-ad-art.mjs --check    exit 1 unless the public files equal a fresh build (byte-exact)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-mall-round4-20261101-01';
const TASK_DIR = 'reference/tasks/mall-round4-20261101';
const CODEX = path.join(root, TASK_DIR, 'codex');
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/mall/ads';
const PROV_REL = 'assets/derivatives/mall-ad-art-20261101.json';
const CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_BEGIN = '<!-- BEGIN mall-ad-art-20261101 (build-ad-art.mjs) -->';
const CREDITS_END = '<!-- END mall-ad-art-20261101 -->';
/** The accepted set (game/src/world/mallAdArt.ts AD_ART_IDS, same order) and a short subject line per source for CREDITS. */
const SOURCES = [
  ['ad-womenswear', "woman in a floral midi dress and camel trench, blush-pink backdrop (women's fashion)"],
  ['ad-menswear', 'man in a charcoal overcoat and plaid scarf, slate-blue backdrop (menswear / department)'],
  ['ad-food', 'double cheeseburger, fries and a drink cup, amber backdrop (food court)'],
  ['ad-cafe', 'latte with foam art, croissant and pastry (cafe / bakery)'],
  ['ad-electronics', 'phone, headphones and laptop, teal-blue backdrop (electronics / phones)'],
  ['ad-health', 'unlabelled skincare bottles and vitamin capsules, mint backdrop (pharmacy / beauty)'],
  ['ad-sports', 'running shoe, daypack and bottle before a mountain ridge (sports / outdoors)'],
  ['ad-shopping', 'jewel-tone shopping bags, gift boxes and flowers (mall-wide / general)'],
];
const SIZE = 512, QUALITY = 85;
const RECIPE = {resize: {width: SIZE, height: SIZE, fit: 'fill (square source: aspect kept, nothing cropped)', kernel: 'lanczos3'},
  colour: 'sRGB, alpha none', encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
  tool: 'sharp (libvips) via tools/asset-pipeline/mall-ads/build-ad-art.mjs'};

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-ad-art: ${m}`); process.exit(1); };
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
  sources.push({id, subject, file, buf, r, prompt, meta});
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
const prov = {schema: 'last-line-derivative/1', asset: 'mall-ad-art-20261101', task: TASK, lane: 'ADS (Mall round 4)',
  status: "runtime derivatives of EIGHT static ad artworks generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit round-4 authorization (\"use codex to produce images for the adds\"; 8 accepted of 8 attempts, cap 12); provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  use: 'game/src/world/mallAds.ts adTexture / drawMenu: the art is cover-cropped under the code-driven fictional brand, headline, price roundel, menu lines and aging overlay (dynamic text, exempt per root CLAUDE.md)',
  rebuild: 'node tools/asset-pipeline/mall-ads/build-ad-art.mjs',
  rawStorage: `${TASK_DIR}/codex/ad-<theme>/{ad-<theme>-original.png, receipt.json, prompt.txt, codex-events.jsonl} + SOURCES-SHA256.txt + ATTEMPTS.jsonl (read-only raw masters, outside Git)`,
  generator: 'Codex native image_gen (owned Codex CLI)',
  recipe: RECIPE,
  files: outputs.map(({s, jpg, rel}) => ({id: s.id, subject: s.subject,
    source: {file: s.file, sha256: s.r.sha256, bytes: s.r.bytes, width: s.r.width, height: s.r.height, channels: s.r.channels, hasAlpha: s.r.hasAlpha},
    codex: {generator: 'Codex native image_gen (owned Codex CLI)', receiptGenerator: s.r.generator, threadId: s.r.codexThreadId,
      nativeOutput: path.basename(s.r.nativeOutput ?? ''), nativeSha256Matches: s.r.nativeSha256Matches, exit: Number(s.r.codexExit), launched: s.r.launched, finished: s.r.finished},
    prompt: s.prompt,
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
const credSection = [CREDITS_BEGIN, '## Mall round 4: advertising artwork', '',
  `Generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool) under the user's explicit round-4 authorization (8 images, task ${TASK}); runtime derivatives (512 px JPEG, resize + format conversion only) built by \`tools/asset-pipeline/mall-ads/build-ad-art.mjs\` (provenance with prompts, Codex thread ids and source hashes: \`${PROV_REL}\`). Fictional and unbranded; the brand names, headlines, prices and menus drawn over them in game are generated at runtime. Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters are kept outside Git.`, '',
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
  console.log('build-ad-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);

fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.rel), o.jpg);
for (const p of stale) fs.rmSync(path.join(PUB, p), {force: true});
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);
fs.writeFileSync(credPath, credNext);
fs.writeFileSync(ALLOW, allowText);
console.log('build-ad-art: wrote', outputs.length, 'textures,', PROV_REL, CREDITS_REL, 'tools/release/public-inputs.json');
