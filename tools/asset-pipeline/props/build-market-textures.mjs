// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): runtime derivatives of the Survivor Market's Codex-generated ORIGINAL
// tileable SURFACE textures — the salvaged corrugated-metal walls, the corrugated shed roof (underside), the salvaged plywood (stall
// alcoves, the rooms under the deck, the deck boards) and the patched canvas tarp of the stall awnings. Root CLAUDE.md "Textures — Codex
// for INITIAL sources": every source is one ledgered Codex native image_gen call (owned Codex CLI); nothing hand-drawn. Processing only:
// resize (sharp lanczos3) and JPEG encoding (the build-skyways-arch-textures.mjs recipe).
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/survivor-market-20261108-005807/textures/):
//   TEXTURE-LEDGER.jsonl (the fsynced intent + result row of every Codex call), raw/codex-<n>-<id>-exec-<id>.png (byte-exact outputs),
//   prompts/<id>.txt
// and writes deterministically:
//   game/public/assets/textures/market/market-<name>.jpg   sRGB JPEG (mozjpeg q85, 4:2:0, metadata stripped), 1024 x 1024
//   game/public/assets/derivatives/market-textures.json   ONE provenance record (per texture: ledger call, Codex session, prompt / raw
//                                                          sha256s, recipe, tile seam check; no prompt text, no URLs, no local paths)
//   game/src/assets/marketTextures.generated.ts           urls / bytes / the real-world span (m) each repeat covers
//   tools/release/public-inputs.json                      ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-market-textures.mjs [--dry-run | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-survivor-market-20261108-005807-01';
const TASK_REL = 'reference/tasks/survivor-market-20261108-005807';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/market';
const PROV_REL = 'assets/derivatives/market-textures.json';
const TS_REL = 'game/src/assets/marketTextures.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const SIZE = 1024;
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-market-textures: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'textures/TEXTURE-LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/textures (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'textures');

// ---------- the accepted Codex outputs (one ledgered call each; all four accepted at their first call) ----------
// `span` = metres one repeat covers [u, v] (measured on the source: ~28 corrugation ribs ~7 cm apart across the wall / roof frames, plywood
// sheets ~1.2 m wide, tarp patches ~0.7-1 m).
const SOURCES = {
  wall: {call: 301, sha256: 'c4cd725dff01647a354d366624419f8e5cd929dff393d4721e333de8eb9763a6', span: [2.0, 2.0],
    subject: 'salvaged corrugated metal sheets in faded oxide red / teal / cream / galvanized grey, vertical ribs, riveted laps, rust streaks; straight-on, tileable',
    use: 'Survivor Market: the shed and stall-row walls (corrugated metal)'},
  roof: {call: 302, sha256: '55aceb0bd0e97371392f744f06ea6d4dd3de09d2afc53e2fba5c2c6bd175d94a', span: [2.0, 2.0],
    subject: 'underside of an old galvanized corrugated steel roof with rust blooms and patched sheets, horizontal ribs; from below, tileable',
    use: 'Survivor Market: the shed roof over the platform, square and deck; the stall / gate ceilings'},
  ply: {call: 303, sha256: '8442abf2ddf6bb35efefc08e79e01f0c783bac3be64f34eed57d02e0caa279b6', span: [2.8, 2.8],
    subject: 'salvaged plywood sheets and scrap boards with peeling paint remnants and nail rows; straight-on, tileable',
    use: 'Survivor Market: the stall alcoves and under-deck rooms (walls), the housing deck (boards) and its underside'},
  tarp: {call: 304, sha256: 'f0027a61afa312e9530bf6bd47b5730dd5c2ff45fd6779b2cf560c6ea0783771', span: [2.4, 2.4],
    subject: 'patched canvas tarpaulin, faded olive / rust orange with sewn-on salvaged fabric patches and stitching; flat, tileable',
    use: 'Survivor Market: the stall awnings (patched canvas)'},
};
const FILE = {wall: 'market-corrugated-wall', roof: 'market-corrugated-roof', ply: 'market-plywood', tarp: 'market-tarp'};

const rows = fs.readFileSync(path.join(GEN, 'TEXTURE-LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** Mean absolute grey difference across the wrap seams vs between neighbouring pixel rows / columns (the tile check). */
async function seamCheck(buf) {
  const {data, info} = await sharp(buf).removeAlpha().greyscale().raw().toBuffer({resolveWithObject: true});
  const W = info.width, H = info.height, g = (x, y) => data[y * W + x];
  const col = (a, b) => { let s = 0; for (let y = 0; y < H; y++) s += Math.abs(g(a, y) - g(b, y)); return s / H; };
  const row = (a, b) => { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(g(x, a) - g(x, b)); return s / W; };
  const r1 = v => Math.round(v * 10) / 10;
  return {seamLR: r1(col(W - 1, 0)), interiorLR: r1((col(W / 2 - 1, W / 2) + col(1, 2)) / 2), seamTB: r1(row(H - 1, 0)), interiorTB: r1((row(H / 2 - 1, H / 2) + row(1, 2)) / 2)};
}

const outputs = [], ts = [], records = {};
for (const [name, s] of Object.entries(SOURCES)) {
  const results = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.n === s.call && r.status === 'ok' && (r.files ?? []).some(f => f.sha256 === s.sha256));
  if (results.length !== 1) fail(`${name}: expected one ledger result row for call ${s.call} with sha256 ${s.sha256}, found ${results.length}`);
  const res = results[0];
  if (res.rc !== 0 || res.files.length !== 1) fail(`${name}: call ${s.call} is not a clean single-image result`);
  const intent = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.t < res.t).pop();
  if (!intent) fail(`${name}: no intent row before the result of call ${s.call}`);
  const file = res.files[0];
  if (!res.session || !file.src.includes(res.session)) fail(`${name}: no Codex session id`);
  const raw = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(raw) !== s.sha256 || raw.length !== file.bytes) fail(`${name}: ${file.raw} does not match its ledger row`);
  const prompt = fs.readFileSync(path.join(GEN, 'prompts', intent.promptFile), 'utf8').trim();
  if (sha(Buffer.from(prompt)) !== intent.promptSha256) fail(`${name}: ${intent.promptFile} differs from the ledgered prompt`);
  const meta = await sharp(raw).metadata();
  const jpg = await sharp(raw).removeAlpha().toColourspace('srgb').resize(SIZE, SIZE, {kernel: 'lanczos3', fit: 'fill'}).toColourspace('srgb')
    .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const m = await sharp(jpg).metadata();
  if (m.width !== SIZE || m.height !== SIZE || m.format !== 'jpeg') fail(`${name}: bad output`);
  const tile = await seamCheck(jpg);
  const rel = `${OUT_DIR_REL}/${FILE[name]}.jpg`;
  records[FILE[name]] = {use: s.use, subject: s.subject,
    codex: {generator: GENERATOR, ledgerCall: s.call, session: res.session, requested: intent.t, finished: res.t, seconds: res.seconds},
    prompt: {file: intent.promptFile, sha256: intent.promptSha256},
    source: {file: path.basename(file.raw), sha256: s.sha256, bytes: raw.length, width: meta.width, height: meta.height},
    recipe: {resize: {width: SIZE, height: SIZE, kernel: 'lanczos3', fit: 'fill'}, colour: 'sRGB, alpha removed',
      encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'}},
    tileCheck: {...tile, note: 'mean absolute grey difference (0..255) across the wrap seams vs between interior neighbour rows / columns'},
    spanM: {u: s.span[0], v: s.span[1]},
    output: {url: rel, bytes: jpg.length, sha256: sha(jpg), width: SIZE, height: SIZE, format: 'jpeg'}};
  outputs.push({path: rel, buf: jpg});
  ts.push({name, url: rel, bytes: jpg.length, span: s.span, tile});
}
const prov = {schema: 'last-line-derivative/1', asset: 'market-textures', task: TASK, lane: 'LEVEL',
  status: "runtime derivatives (resize / JPEG only) of ORIGINAL tileable surface textures generated for this project with Codex native image_gen (owned Codex CLI) under the user's art authorization for the Survivor Market (Codex initial images, no numerical cap); provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  rebuild: 'node tools/asset-pipeline/props/build-market-textures.mjs',
  rawStorage: `${TASK_REL}/textures/{TEXTURE-LEDGER.jsonl, raw/codex-<n>-<id>-exec-<id>.png, prompts/<id>.txt} (private, outside Git)`,
  generator: GENERATOR, tool: 'sharp (libvips) via tools/asset-pipeline/props/build-market-textures.mjs', textures: records};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
outputs.push({path: PROV_REL, buf: provBuf});

const tsText = [
  `// GENERATED by tools/asset-pipeline/props/build-market-textures.mjs — do not edit (task ${TASK}, lane LEVEL).`,
  "// The Survivor Market's ORIGINAL Codex-generated tileable surface textures (resize / JPEG only): salvaged corrugated-metal walls, the",
  '// corrugated shed roof, salvaged plywood, the patched canvas awning tarp. Provenance assets/derivatives/market-textures.json.',
  '// span = metres one repeat covers (u, v).',
  'export interface MarketTexture { readonly url: string; readonly bytes: number; readonly span: readonly [number, number] }',
  'export const MARKET_TEXTURES = {',
  ...ts.map(t => `  ${t.name}: {url: '${t.url}', bytes: ${t.bytes}, span: [${t.span[0]}, ${t.span[1]}]},`),
  '} as const satisfies Readonly<Record<string, MarketTexture>>;',
  'export type MarketTextureKey = keyof typeof MARKET_TEXTURES;',
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
  console.log('build-market-textures: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), tsText);
fs.writeFileSync(ALLOW, allowText);
console.log('build-market-textures: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
