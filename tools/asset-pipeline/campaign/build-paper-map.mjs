// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): the runtime derivative of the ONE Codex-generated paper sheet of
// the in-game subway map (root CLAUDE.md "Textures — Codex for INITIAL sources": the static paper art comes from Codex image generation;
// the network itself — lines, stations, labels, legend — is drawn DYNAMICALLY over it at runtime by game/src/ui/paperMap.ts).
//
// Reads (never modifies) the primary's raw master kept OUTSIDE Git:
//   reference/tasks/campaign-foundation-20261102-230708/codex/paper-map-attempt1.png  (byte-exact Codex native image_gen output, 1536 x 1024)
//   reference/tasks/campaign-foundation-20261102-230708/codex/ATTEMPTS.jsonl          (intent -> result -> accepted; session / hashes)
// and writes deterministically:
//   game/public/assets/textures/paper-map.jpg                 1152 x 768 sRGB JPEG (sharp lanczos3 resize, mozjpeg q56, 4:2:0, no metadata)
//   game/public/assets/derivatives/paper-map-20261102.json    provenance (no URLs, no local absolute paths, no secrets)
//   game/public/assets/CREDITS.md                             the marked section below
//   tools/release/public-inputs.json                          ONLY this script's paths (+ CREDITS.md, whose bytes change)
// Processing only (resize + format conversion; the size is set by the ~170 KB static-host headroom): no drawing, no retouching.
//
// Usage: node tools/asset-pipeline/campaign/build-paper-map.mjs [--dry-run | --check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-alpha-campaign-foundation-20261102-230708-01';
const CODEX_REL = 'reference/tasks/campaign-foundation-20261102-230708/codex';
const SRC_REL = `${CODEX_REL}/paper-map-attempt1.png`;
const SRC_SHA = '196e5054cd82284a2608b70701b28d7351cafbd93c84214d393567becd073bb4';
const PUB = path.join(root, 'game/public');
const OUT_REL = 'assets/textures/paper-map.jpg';
const PROV_REL = 'assets/derivatives/paper-map-20261102.json';
const CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_BEGIN = '<!-- BEGIN paper-map-20261102 (build-paper-map.mjs) -->';
const CREDITS_END = '<!-- END paper-map-20261102 -->';
const OPTIONS = {width: 1152, height: 768, quality: 56};
const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run'), CHECK = ARGS.has('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error('build-paper-map:', m); process.exit(1); };

const src = fs.readFileSync(path.join(root, SRC_REL));
if (sha(src) !== SRC_SHA) fail(`raw master changed or missing: ${SRC_REL}`);
const rows = fs.readFileSync(path.join(root, CODEX_REL, 'ATTEMPTS.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const accepted = rows.find(r => r.event === 'accepted' && r.tag === 'paper-map' && r.sha256 === SRC_SHA);
const result = rows.find(r => r.event === 'result' && r.tag === 'paper-map' && r.attempt === accepted?.attempt);
if (!accepted || !result) fail('no accepted paper-map attempt in ATTEMPTS.jsonl');
const launches = rows.filter(r => r.event === 'intent').length;

const jpg = await sharp(src).resize(OPTIONS.width, OPTIONS.height, {kernel: 'lanczos3', fit: 'fill'})
  .jpeg({quality: OPTIONS.quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();

const prov = {
  task: TASK, asset: OUT_REL, kind: 'static paper texture of the in-game subway map (the network is drawn dynamically over it)',
  source: {file: SRC_REL, sha256: SRC_SHA, bytes: src.length, png: result.outputs?.[0]?.png ?? null,
    route: 'codex-cli built-in image_gen (tools.image_gen__imagegen), text prompt only', codexSession: result.codexSession, agentModel: result.agentModel,
    imageModel: 'unreported by the tool', attempt: accepted.attempt, launchesThisTask: launches, prompt: `${CODEX_REL}/PROMPT-paper.json`},
  processing: {resize: `${OPTIONS.width}x${OPTIONS.height} lanczos3`, format: `JPEG mozjpeg q${OPTIONS.quality} 4:2:0`, edits: 'none (resize + format only)'},
  output: {bytes: jpg.length, sha256: sha(jpg)},
  status: {approved: false, gameReady: true, licenseClearance: 'none implied (AI-generated prototype asset)'},
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces|\/home\/).{0,20}/i); if (hit) fail(`URL / path-like string in public provenance: ...${hit[0]}...`); }

const credPath = path.join(PUB, CREDITS_REL);
const credText = fs.readFileSync(credPath, 'utf8');
const credSection = [CREDITS_BEGIN, '## Campaign: the paper subway map', '',
  `- \`${OUT_REL}\` — the blank old folded paper sheet of the in-game subway map. Generated for this project with Codex's built-in image tool (one call under the task's 8-call authorization); runtime derivative by \`tools/asset-pipeline/campaign/build-paper-map.mjs\` (resize + JPEG only; provenance: \`${PROV_REL}\`). The lines, stations and labels are drawn at runtime. AI-generated asset: unapproved prototype, no licence or commercial clearance implied. The raw master is kept outside Git.`,
  CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credRe.test(credText) ? credText.replace(credRe, credSection) : credText.replace(/\s*$/, '\n\n') + credSection + '\n';

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const files = [{path: OUT_REL, buf: jpg}, {path: PROV_REL, buf: provBuf}, {path: CREDITS_REL, buf: Buffer.from(credNext)}];
const mine = new Set(files.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...files.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';
console.log(JSON.stringify({task: TASK, output: {url: OUT_REL, bytes: jpg.length, sha256: sha(jpg)}, provenance: {url: PROV_REL, bytes: provBuf.length}}, null, 1));

if (CHECK) {
  const diff = [...files.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-paper-map: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.writeFileSync(path.join(PUB, OUT_REL), jpg);
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);
fs.writeFileSync(credPath, credNext);
fs.writeFileSync(ALLOW, allowText);
console.log('build-paper-map: wrote', OUT_REL, PROV_REL, CREDITS_REL, 'tools/release/public-inputs.json');
