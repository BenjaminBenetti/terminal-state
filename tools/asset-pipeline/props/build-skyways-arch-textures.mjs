// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): runtime derivatives of the Skyways rework's Codex-generated ORIGINAL
// tileable SURFACE textures — the skylit / atrium courts' herringbone brick floor, their red-brown brick wall and dark timber slat ceiling,
// and the glazed bridges' dark clay paver floor. Root CLAUDE.md "Textures — Codex for INITIAL sources": every source is one Codex native
// image_gen call through the lead's ledgered helper; nothing hand-drawn. Processing only: a deterministic tile crop (a whole number of
// brick courses where the source's own vertical period is not the frame), resize (sharp lanczos3) and JPEG encoding.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/skyways-rework-20261107-054512/gen/):
//   LEDGER.jsonl (the intent + result row of every Codex call), raw/codex-<n>-exec-<id>.png (byte-exact outputs), prompts/arch-<n>.txt
// and writes deterministically:
//   game/public/assets/textures/skyways/arch/skyways-arch-<name>.jpg   sRGB JPEG (mozjpeg q85, 4:2:0, metadata stripped), 1024 x 1024
//   game/public/assets/derivatives/skyways-arch-<name>.json            provenance (ledger call, Codex session, prompt / raw sha256s, crop,
//                                                                      tile seam check; no prompt text, no URLs, no local paths)
//   game/src/assets/skywaysArchTextures.generated.ts                   urls / bytes / the real-world span (m) each repeat covers
//   tools/release/public-inputs.json                                   ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-skyways-arch-textures.mjs [--dry-run | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-skyways-rework-20261107-054512-01';
const TASK_REL = 'reference/tasks/skyways-rework-20261107-054512';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/skyways/arch';
const PROV_DIR_REL = 'assets/derivatives';
const TS_REL = 'game/src/assets/skywaysArchTextures.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const SIZE = 1024;
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-skyways-arch-textures: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex outputs (one ledgered call each; all four accepted at their first call) ----------
// `crop` = the tile box [x, y, w, h] in source pixels (the brick wall: 14 whole courses, the source's measured vertical period 1043 px —
// its full frame ends mid-course); `span` = metres one repeat covers [u, v] (measured on the source: ~1 mm per pixel, a ~205 mm brick /
// paver, ~60 mm slat pitch).
const SOURCES = {
  herringbone: {call: 101, sha256: '4060935fde6910329f7d7cd3e4a9e6ccdcc34e9bebbd2301f213450b682e7831', span: [1.3, 1.3],
    subject: 'herringbone glazed clay brick paver floor (warm terracotta / amber / chocolate), top-down, tileable',
    use: 'Skyways skylit / atrium courts: the floor (herringbone brick)'},
  brickWall: {call: 102, sha256: '3a500cbda93565cce2f27430f8fa3f33f3b381a3098316a6375b5f80943951b6', span: [1.254, 1.043], crop: [0, 0, 1254, 1043],
    subject: 'red-brown face-brick wall in running bond, straight-on, tileable',
    use: 'Skyways skylit / atrium courts: the walls (face brick)'},
  woodSlats: {call: 103, sha256: '1f8f58854ba2e2ab96c0fb608283a6dc7410b5976dde71e8cab865f1b3d7c685', span: [1.5, 1.5],
    subject: 'dark walnut timber slat ceiling with black reveals, seen from below, tileable',
    use: 'Skyways skylit / atrium courts: the ceiling between the skylight coffers (timber slats)'},
  pavers: {call: 104, sha256: '458ec2a2635857324652e7805bf6312351e82b9b519fc44bea1f953c633a0dc7', span: [1.25, 1.25],
    subject: 'dark red-brown clay brick pavers in stretcher bond, top-down, tileable',
    use: 'Skyways glazed bridges (layout version 3): the deck floor (clay pavers)'},
};
const FILE = {herringbone: 'skyways-arch-herringbone', brickWall: 'skyways-arch-brick-wall', woodSlats: 'skyways-arch-wood-slats', pavers: 'skyways-arch-pavers'};

const rows = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** Mean absolute grey difference across the wrap seams vs between neighbouring pixel rows / columns (the tile check). */
async function seamCheck(buf) {
  const {data, info} = await sharp(buf).removeAlpha().greyscale().raw().toBuffer({resolveWithObject: true});
  const W = info.width, H = info.height, g = (x, y) => data[y * W + x];
  const col = (a, b) => { let s = 0; for (let y = 0; y < H; y++) s += Math.abs(g(a, y) - g(b, y)); return s / H; };
  const row = (a, b) => { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(g(x, a) - g(x, b)); return s / W; };
  const r1 = v => Math.round(v * 10) / 10;
  return {seamLR: r1(col(W - 1, 0)), interiorLR: r1((col(W / 2 - 1, W / 2) + col(1, 2)) / 2), seamTB: r1(row(H - 1, 0)), interiorTB: r1((row(H / 2 - 1, H / 2) + row(1, 2)) / 2)};
}

const outputs = [], ts = [];
for (const [name, s] of Object.entries(SOURCES)) {
  const results = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.n === s.call && (r.files ?? []).some(f => f.sha256 === s.sha256));
  if (results.length !== 1) fail(`${name}: expected one ledger result row for call ${s.call} with sha256 ${s.sha256}, found ${results.length}`);
  const res = results[0];
  if (res.rc !== 0 || res.files.length !== 1) fail(`${name}: call ${s.call} is not a clean single-image result`);
  const intent = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.t < res.t).pop();
  if (!intent) fail(`${name}: no intent row before the result of call ${s.call}`);
  const file = res.files[0];
  const session = /generated_images\/([0-9a-f-]{36})\//.exec(file.src)?.[1];
  if (!session) fail(`${name}: no Codex session id`);
  const raw = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(raw) !== s.sha256 || raw.length !== file.bytes) fail(`${name}: ${file.raw} does not match its ledger row`);
  const prompt = fs.readFileSync(path.join(GEN, 'prompts', intent.promptFile), 'utf8').trim();
  if (sha(Buffer.from(prompt)) !== intent.promptSha256) fail(`${name}: ${intent.promptFile} differs from the ledgered prompt`);
  const meta = await sharp(raw).metadata();
  const [cx, cy, cw, ch] = s.crop ?? [0, 0, meta.width, meta.height];
  if (cx < 0 || cy < 0 || cx + cw > meta.width || cy + ch > meta.height) fail(`${name}: crop outside the source`);
  const cropped = await sharp(raw).removeAlpha().toColourspace('srgb').extract({left: cx, top: cy, width: cw, height: ch}).png().toBuffer();
  const jpg = await sharp(cropped).resize(SIZE, SIZE, {kernel: 'lanczos3', fit: 'fill'}).toColourspace('srgb')
    .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const m = await sharp(jpg).metadata();
  if (m.width !== SIZE || m.height !== SIZE || m.format !== 'jpeg') fail(`${name}: bad output`);
  const tile = await seamCheck(jpg);
  const rel = `${OUT_DIR_REL}/${FILE[name]}.jpg`, provRel = `${PROV_DIR_REL}/${FILE[name]}.json`;
  const prov = {schema: 'last-line-derivative/1', asset: FILE[name], task: TASK, lane: 'ARCH',
    status: "runtime derivative (tile crop / resize / JPEG only) of an ORIGINAL tileable surface texture generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit art authorization for the Skyways rework (no numerical image cap, user override); provider terms apply; unapproved prototype, no licence or commercial clearance implied",
    use: s.use, subject: s.subject,
    rebuild: 'node tools/asset-pipeline/props/build-skyways-arch-textures.mjs',
    rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-exec-<id>.png, prompts/arch-<n>.txt} (private, outside Git)`,
    generator: GENERATOR,
    codex: {generator: GENERATOR, ledgerCall: s.call, session, requested: intent.t, finished: res.t, seconds: res.seconds},
    prompt: {file: intent.promptFile, sha256: intent.promptSha256},
    source: {file: path.basename(file.raw), sha256: s.sha256, bytes: raw.length, width: meta.width, height: meta.height},
    recipe: {crop: {x: cx, y: cy, w: cw, h: ch, why: s.crop ? 'a whole number of brick courses (the source\'s measured vertical repeat)' : 'full frame (tiles as delivered)'},
      resize: {width: SIZE, height: SIZE, kernel: 'lanczos3', fit: 'fill'}, colour: 'sRGB, alpha removed',
      encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
      tool: 'sharp (libvips) via tools/asset-pipeline/props/build-skyways-arch-textures.mjs'},
    tileCheck: {...tile, note: 'mean absolute grey difference (0..255) across the wrap seams vs between interior neighbour rows / columns'},
    spanM: {u: s.span[0], v: s.span[1]},
    output: {url: rel, bytes: jpg.length, sha256: sha(jpg), width: SIZE, height: SIZE, format: 'jpeg'}};
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
  if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
  outputs.push({path: rel, buf: jpg}, {path: provRel, buf: provBuf});
  ts.push({name, url: rel, bytes: jpg.length, span: s.span, tile});
}

const tsText = [
  `// GENERATED by tools/asset-pipeline/props/build-skyways-arch-textures.mjs — do not edit (task ${TASK}, lane ARCH).`,
  "// The Skyways rework's ORIGINAL Codex-generated tileable surface textures (tile crop / resize / JPEG only): the courts' herringbone brick",
  '// floor, brick wall and timber slat ceiling, the glazed bridges\' clay paver floor. Provenance assets/derivatives/skyways-arch-<name>.json.',
  '// span = metres one repeat covers (u, v).',
  'export interface SkywaysArchTexture { readonly url: string; readonly bytes: number; readonly span: readonly [number, number] }',
  'export const SKYWAYS_ARCH_TEXTURES = {',
  ...ts.map(t => `  ${t.name}: {url: '${t.url}', bytes: ${t.bytes}, span: [${t.span[0]}, ${t.span[1]}]},`),
  '} as const satisfies Readonly<Record<string, SkywaysArchTexture>>;',
  'export type SkywaysArchTextureKey = keyof typeof SKYWAYS_ARCH_TEXTURES;',
  '',
].join('\n');

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path)), ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';
console.log(JSON.stringify({task: TASK, outputs: outputs.map(o => ({path: o.path, bytes: o.buf.length, sha256: sha(o.buf)})), tiles: ts.map(t => ({name: t.name, ...t.tile})),
  textureBytes: outputs.filter(o => o.path.endsWith('.jpg')).reduce((n, o) => n + o.buf.length, 0)}, null, 1));
if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === tsText ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-skyways-arch-textures: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), tsText);
fs.writeFileSync(ALLOW, allowText);
console.log('build-skyways-arch-textures: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
