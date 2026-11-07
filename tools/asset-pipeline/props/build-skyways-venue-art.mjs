// Task studio-skyways-rework-20261107-054512-01 (lane VENUE): runtime derivative of the convention VENUE's Codex-generated ORIGINAL artwork
// — the photo lounge's photo-op wall, the panel rooms' two title slides, the registration sign and the four artist-alley booth banners
// (root CLAUDE.md "Textures — Codex for INITIAL sources": every source is one Codex native image_gen call through the lead's ledgered helper
// gen/codex_image.py, lane ids 200-299; nothing hand-drawn). Processing only: crop / resize (sharp lanczos3) / pack into one JPEG atlas.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/skyways-rework-20261107-054512/gen/):
//   LEDGER.jsonl (the intent + result row of every Codex call)   raw/codex-<n>-exec-<id>.png (the byte-exact outputs)
//   prompts/venue-<n>.txt (the prompts; only their sha256 is published)
// and writes deterministically:
//   game/public/assets/textures/skyways/skyways-venue-art.jpg   the sRGB JPEG atlas (mozjpeg q85, 4:2:0, metadata stripped)
//   game/public/assets/derivatives/skyways-venue-art.json       its provenance (ledger calls, Codex sessions, prompt / raw sha256s, crops)
//   game/src/assets/skywaysVenueArt.generated.ts                the atlas url / size / per-piece UV rects (three.js convention)
//   tools/release/public-inputs.json                            ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-skyways-venue-art.mjs [--dry-run | --check] [--task-dir=<private task folder>]
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
const FILE = 'skyways-venue-art';
const OUT_REL = `assets/textures/skyways/${FILE}.jpg`, PROV_REL = `assets/derivatives/${FILE}.json`;
const TS_REL = 'game/src/assets/skywaysVenueArt.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const FILL = {r: 24, g: 24, b: 28};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';
const W = 2048, H = 1536;

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-skyways-venue-art: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex outputs (one ledgered call each; `sha256` = the accepted raw file) ----------
const SOURCES = {
  'photo-wall': {call: 201, sha256: '9e41a72eeccd5adf4bbc671abc6aa98cd3c91429c191304c633c1af9cb65a13b', subject: 'photo-op wall: "AURORA ANIME FEST" / "PHOTO SPOT" + the mascot Kumako, two ghosts and a bear over an aurora skyline'},
  'slide-draw': {call: 202, sha256: '410e894d0375a0e9cfad01e96b531a48cb9856bb95d9c401fb7fad9e3efcf221', subject: 'panel title slide: "DRAW YOUR OWN HERO" / "ART WORKSHOP" + Kumako at a drawing desk'},
  'slide-cosplay': {call: 203, sha256: 'be436c76e47c2da9e17bf6f88577f4ca9dfa610c89fad05cf692252e8097052a', subject: 'panel title slide: "COSPLAY CRAFT TALK" / "FOAM, FABRIC & FUN" + Kumako with a foam star wand'},
  'registration': {call: 204, sha256: '42057965c6c869a5db53f2815f9489b78dcb076cebb5d1ae08564cfdc47eb0d3', subject: 'registration sign: "AURORA ANIME FEST" / "REGISTRATION" / "BADGE PICKUP" + Kumako holding up a badge'},
  'booths': {call: 205, sha256: 'd1da1a9d65945ea01e18227c83ca0a65b5b52e2f14852f472a73c0381443aac2', subject: 'artist-alley booth banners sheet: four invented studios (MOCHI PRINTS, STARDUST STUDIO, PIXEL FOX ART, HOSHI CRAFTS)'},
};
const SLIDES = ['slide-draw', 'slide-cosplay'];
const BOOTHS = ['booth-mochi', 'booth-stardust', 'booth-pixelfox', 'booth-hoshi'];
/** The four banners of the booth sheet: source pixel boxes [x0, y0, x1, y1) inside the grey gutters (measured on the accepted image). */
const BOOTH_BOX = {
  'booth-mochi': [7, 8, 760, 502], 'booth-stardust': [776, 8, 1529, 502], 'booth-pixelfox': [7, 521, 760, 1015], 'booth-hoshi': [776, 521, 1529, 1015],
}; // (gutters measured on the sheet: columns 764-771, rows 506-516, a 3-4 px outer border; boxes inset 4 px from them)
/** Atlas slots (atlas px, y down): `box` = a source sub-box to crop first (then a centred cover crop to the slot's aspect). */
const SLOTS = [
  {name: 'photo-wall', source: 'photo-wall', x: 0, y: 0, w: 1536, h: 1024},
  ...BOOTHS.map((name, k) => ({name, source: 'booths', box: BOOTH_BOX[name], x: 1536, y: k * 256, w: 384, h: 256})),
  {name: 'slide-draw', source: 'slide-draw', x: 0, y: 1024, w: 768, h: 512},
  {name: 'slide-cosplay', source: 'slide-cosplay', x: 768, y: 1024, w: 768, h: 512},
  {name: 'registration', source: 'registration', x: 1536, y: 1024, w: 512, h: 341},
];

function coverRect(srcW, srcH, aspect) {
  let w = srcW, h = Math.round(srcW / aspect);
  if (h > srcH) { h = srcH; w = Math.round(srcH * aspect); }
  return {x: Math.round((srcW - w) / 2), y: Math.round((srcH - h) / 2), w, h};
}
const r6 = v => Math.round(v * 1e6) / 1e6;
const uvOf = (x, y, w, h) => ({u0: r6((x + 0.5) / W), v0: r6(1 - (y + h - 0.5) / H), u1: r6((x + w - 0.5) / W), v1: r6(1 - (y + 0.5) / H), aspect: r6(w / h)});

// ---------- ledger rows -> verified sources ----------
const rows = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const src = {};
for (const [name, s] of Object.entries(SOURCES)) {
  const results = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.n === s.call && (r.files ?? []).some(f => f.sha256 === s.sha256));
  if (results.length !== 1) fail(`${name}: expected one ledger result row for call ${s.call} with sha256 ${s.sha256}, found ${results.length}`);
  const res = results[0];
  if (res.rc !== 0 || res.files.length !== 1) fail(`${name}: call ${s.call} is not a clean single-image result`);
  const intent = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.t < res.t).pop() ?? fail(`${name}: no intent row`);
  const file = res.files[0];
  const session = /generated_images\/([0-9a-f-]{36})\//.exec(file.src)?.[1] ?? fail(`${name}: no Codex session id`);
  const buf = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(buf) !== s.sha256 || buf.length !== file.bytes) fail(`${name}: ${file.raw} does not match its ledger row`);
  const prompt = fs.readFileSync(path.join(GEN, 'prompts', intent.promptFile), 'utf8').trim();
  if (sha(Buffer.from(prompt)) !== intent.promptSha256) fail(`${name}: ${intent.promptFile} differs from the prompt the ledger recorded`);
  src[name] = {...s, buf, meta: await sharp(buf).metadata(), session, rawFile: path.basename(file.raw), intentT: intent.t, resultT: res.t, seconds: res.seconds,
    promptFile: intent.promptFile, promptSha256: intent.promptSha256};
}

// ---------- build ----------
const layers = [], pieces = {}, provPieces = [];
for (const slot of SLOTS) {
  const s = src[slot.source];
  const b = slot.box ?? [0, 0, s.meta.width, s.meta.height];
  const c = coverRect(b[2] - b[0], b[3] - b[1], slot.w / slot.h), crop = {x: b[0] + c.x, y: b[1] + c.y, w: c.w, h: c.h};
  const img = await sharp(s.buf).removeAlpha().toColourspace('srgb').extract({left: crop.x, top: crop.y, width: crop.w, height: crop.h})
    .resize(slot.w, slot.h, {kernel: 'lanczos3', fit: 'fill'}).png().toBuffer();
  layers.push({input: img, left: slot.x, top: slot.y});
  pieces[slot.name] = uvOf(slot.x, slot.y, slot.w, slot.h);
  provPieces.push({name: slot.name, subject: s.subject,
    codex: {generator: GENERATOR, ledgerCall: s.call, session: s.session, requested: s.intentT, finished: s.resultT, seconds: s.seconds},
    prompt: {file: s.promptFile, sha256: s.promptSha256},
    source: {file: s.rawFile, sha256: s.sha256, bytes: s.buf.length, width: s.meta.width, height: s.meta.height},
    crop, placed: {x: slot.x, y: slot.y, w: slot.w, h: slot.h}});
}
const jpg = await sharp({create: {width: W, height: H, channels: 3, background: FILL}}).composite(layers)
  .toColourspace('srgb').jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
const m = await sharp(jpg).metadata();
if (m.width !== W || m.height !== H || m.format !== 'jpeg') fail(`bad atlas ${m.width}x${m.height} ${m.format}`);
const prov = {schema: 'last-line-derivative/1', asset: FILE, task: TASK, lane: 'VENUE',
  status: "runtime derivative (crop / resize / atlas pack only) of ORIGINAL static artwork generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit authorization for Skyways art (no numerical image cap, user override); invented characters, titles and studio names; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
  use: 'Skyways convention venue (layout version 3): the photo lounge\'s photo-op wall (1536 x 1024), the panel rooms\' two title slides (768 x 512), the registration sign (512 x 341) and four artist-alley booth banners (384 x 256, cropped from one sheet)',
  rebuild: 'node tools/asset-pipeline/props/build-skyways-venue-art.mjs',
  rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-exec-<id>.png, prompts/venue-<n>.txt} (private, outside Git)`,
  generator: GENERATOR,
  recipe: {crop: 'centred cover crop to the slot aspect (the booth banners: inside their sheet cell first)', resize: {kernel: 'lanczos3', fit: 'fill'}, colour: 'sRGB, alpha removed',
    pack: `atlas ${W}x${H}, empty area rgb(${FILL.r},${FILL.g},${FILL.b})`, encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    uv: 'three.js convention (v = 0 at the image bottom), each rect inset by half a texel', tool: 'sharp (libvips) via tools/asset-pipeline/props/build-skyways-venue-art.mjs'},
  output: {url: OUT_REL, bytes: jpg.length, sha256: sha(jpg), width: W, height: H, format: 'jpeg'},
  pieces: provPieces};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
const outputs = [{path: OUT_REL, buf: jpg}, {path: PROV_REL, buf: provBuf}];

const fmtPiece = p => `{u0: ${p.u0}, v0: ${p.v0}, u1: ${p.u1}, v1: ${p.v1}, aspect: ${p.aspect}}`;
const ts = [
  `// GENERATED by tools/asset-pipeline/props/build-skyways-venue-art.mjs — do not edit (task ${TASK}, lane VENUE).`,
  "// The Skyways convention VENUE's ORIGINAL Codex-generated artwork packed into one JPEG atlas (crop / resize / pack only): the photo",
  "// lounge's photo-op wall, the panel rooms' title slides, the registration sign and the artist-alley booth banners. Provenance",
  `// ${PROV_REL}. UVs: three.js convention (v = 0 at the image bottom, flipY textures), each rect inset by half a texel; aspect = w / h.`,
  "import type {SkywaysArtAtlas} from './skywaysArt.generated';",
  'export const SKYWAYS_VENUE_ART = {',
  `  venueArt: {url: '${OUT_REL}', width: ${W}, height: ${H}, pieces: {`,
  ...Object.entries(pieces).map(([n, p]) => `    '${n}': ${fmtPiece(p)},`),
  '  }},',
  '} as const satisfies Readonly<Record<string, SkywaysArtAtlas>>;',
  `export const SKYWAYS_VENUE_SLIDES = [${SLIDES.map(n => `'${n}'`).join(', ')}] as const;`,
  `export const SKYWAYS_VENUE_BOOTHS = [${BOOTHS.map(n => `'${n}'`).join(', ')}] as const;`,
  '',
].join('\n');

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
  console.log('build-skyways-venue-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
for (const o of outputs) { fs.mkdirSync(path.dirname(path.join(PUB, o.path)), {recursive: true}); fs.writeFileSync(path.join(PUB, o.path), o.buf); }
fs.writeFileSync(path.join(root, TS_REL), ts);
fs.writeFileSync(ALLOW, allowText);
console.log('build-skyways-venue-art: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
