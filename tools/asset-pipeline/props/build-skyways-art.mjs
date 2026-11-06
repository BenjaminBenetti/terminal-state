// Task studio-skyways-level-20261106-054448-01 (lane ART): runtime derivatives of the Skyways level's Codex-generated ORIGINAL artwork —
// the anime convention add-on (eight series posters, three hanging banners, the main-stage backdrop, the welcome sign, the merch-table
// prints sheet), the prize-car add-on's prize-draw board and the ramen restaurant's noren / menu / promo poster (root CLAUDE.md "Textures —
// Codex for INITIAL sources": every source is one Codex native image_gen call through the lead's ledgered helper; nothing hand-drawn).
// Processing only: crop / resize (sharp lanczos3) / pack into JPEG atlases. The menu board's prices are NOT in the art (drawn at runtime).
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/skyways-level-20261106-054448/gen/):
//   LEDGER.jsonl (the intent + result row of every Codex call: call number, prompt file + sha256, output file + sha256)
//   raw/codex-<n>-exec-<id>.png (the byte-exact Codex outputs)   prompts/art-<nn>.txt (the prompts; only their sha256 is published)
// and writes deterministically:
//   game/public/assets/textures/skyways/skyways-<atlas>.jpg   sRGB JPEG atlases (mozjpeg q85, 4:2:0, metadata stripped)
//   game/public/assets/derivatives/skyways-<atlas>.json       provenance per atlas (ledger call numbers, Codex session ids, prompt and
//                                                             raw sha256s, crop / placement rects; no prompt text, no URLs, no local paths)
//   game/src/assets/skywaysArt.generated.ts                   atlas urls / sizes / per-piece UV rects (three.js convention, v = 0 at the
//                                                             image bottom; each rect inset by half a texel against neighbour bleed)
//   tools/release/public-inputs.json                          ONLY this script's public paths (sorted, existing format)
//
// Usage: node tools/asset-pipeline/props/build-skyways-art.mjs [--dry-run | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-skyways-level-20261106-054448-01';
const TASK_REL = 'reference/tasks/skyways-level-20261106-054448';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/skyways';
const PROV_DIR_REL = 'assets/derivatives';
const TS_REL = 'game/src/assets/skywaysArt.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const QUALITY = 85;
const FILL = {r: 24, g: 24, b: 28};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-skyways-art: ${m}`); process.exit(1); };

// ---------- the private task folder (main checkout: <root>/reference; a .claude/worktrees/<lane> checkout: walk up) ----------
function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex outputs (one ledgered call each; `sha256` = the accepted raw file) ----------
// `focus` = the crop centre (0..1 of the source) where a crop to the slot's aspect is needed (default: centred).
// Rejected calls (kept in the private ledger / raw folder, never shipped): 1 (poster title "STEEL HORIZON" coincides with an existing game
// title and the robot wore a V-shaped crest -> 101), 3 (title / look too close to an existing slice-of-life series -> 103), 15 (a small
// emblem on the car's bonnet despite "no badges" -> 115).
const SOURCES = {
  'dawnstrider': {call: 101, sha256: 'b94ac6a8971845ba01210e14fdb610934b4ecf5c5ab1173853a052481bc9424f', subject: 'convention poster: invented mecha series "DAWNSTRIDER"'},
  'starlight-prism': {call: 2, sha256: '5c68ea590023593ad4501af56b08f73b64117b675467be034f8abdfe0ec7a589', subject: 'convention poster: invented magical-girl series "STARLIGHT PRISM"'},
  'petal-cafe-club': {call: 103, sha256: '4e71dff30ae44276a1cfb7806e9aefef8355219887306f5ef86d3cf6e856edb1', subject: 'convention poster: invented slice-of-life series "PETAL CAFE CLUB"'},
  'rift-blade': {call: 4, sha256: '2311ad7b6776839f7cb08baec8bf2ef7425e2b460c12556eb4d50e100d353516', subject: 'convention poster: invented battle-action series "RIFT BLADE"'},
  'nova-beat': {call: 5, sha256: '9491ce6be3ab1c9145856b61be20d4bdb79efbfa56f7123489c9249674b6953c', subject: 'convention poster: invented idol-group series "NOVA BEAT"'},
  'lumeria-quest': {call: 6, sha256: '360439aff123180639734223193b09b17d911110bee64c89f144185ce4a45245', subject: 'convention poster: invented isekai fantasy series "LUMERIA QUEST"'},
  'relay-rush': {call: 7, sha256: '1454dd4c8b6a0f5a57ab3bda95b9e7d406f93219501e7a60ad0536fb19f2fba4', subject: 'convention poster: invented sports series "RELAY RUSH"'},
  'spooky-share-house': {call: 8, sha256: '376ce8fe767ceca09e24a23d361eae42e86c1714acefc51a416be57961984025', subject: 'convention poster: invented cozy horror-comedy series "SPOOKY SHARE HOUSE"'},
  'banner-wave': {call: 9, sha256: '7ad5de6971fb5666339514a776b97ee2d770a3559f0fa73abc0a964e2c32a0e4', subject: 'hanging banner: "AURORA ANIME FEST" + the mascot Kumako waving'},
  'banner-jump': {call: 10, sha256: '2d099e78d3cc989a141bd70a846a70a875505f7cec3568fe263f4b80258182c9', subject: 'hanging banner: Kumako jumping + "AURORA ANIME FEST"'},
  'banner-moon': {call: 11, sha256: '7461ac023e8b94a0080319faf705cb9770181d23879287c078869cd793614715', subject: 'hanging banner: "AURORA ANIME FEST" + Kumako on a crescent moon'},
  'backdrop': {call: 12, sha256: 'a685fcbe00410cf50c837d357a4e58832c3a15876aa385d9f482774b83b32d6f', subject: 'main-stage backdrop: "AURORA ANIME FEST" / "MAIN STAGE" + Kumako and invented characters'},
  'welcome': {call: 13, sha256: 'd3f2459a7330855f6a9d56fdcd0c812fa0d609b39dcfc4ef46b08798c432c40f', subject: 'welcome sign: Kumako waving + "WELCOME TO AURORA ANIME FEST"'},
  'prints': {call: 14, sha256: '8ec8b4ecfa68f408272ae22f2a8be79f2687c3197bbefd91d8fedac1651674e0', subject: 'merch-table prints sheet: four chibi art prints (Kumako, magical girl, swordsman, ghost)'},
  'board': {call: 115, sha256: '9a06a6110da11e7e173b7e27dc81f54f84173f6f04c05d1c6368d663adbf68c7', subject: 'prize-draw board: "GRAND PRIZE DRAW" / "SKYWAYS SPRING GIVEAWAY" + an invented unbadged red coupe on a display platform'},
  'noren': {call: 16, sha256: 'c979ca2bc57844d2d4ecfd21b4b0945bc81796722b9bef90843a7b1fb048b792', subject: 'ramen restaurant noren curtain: "MENYA HOSHI" / 麺屋 星 + a ramen bowl'},
  'menu': {call: 17, sha256: 'a42171ca2db5412d0bf483c8f336f9a7a2fc5ae331e0ea37317fe63056e97621', subject: 'ramen restaurant illustrated menu board: six dishes with names and EMPTY price strips (no prices)'},
  'poster': {call: 18, sha256: '34fbf6e39cc28363848d6fef588a4d986069f1aa13b3cfeac9aeb107cb7a04a6', subject: 'ramen restaurant promo poster: "MENYA HOSHI" / "TONKOTSU RAMEN"'},
};

// ---------- atlases: slot rects in atlas pixels (y down); `sub` = extra named UV rects inside a slot, as SOURCE pixel boxes
// [x0, y0, x1, y1) measured on the accepted image (print cards incl. their white border; the menu's empty price strips inside their
// outline); `groups` = exported name lists ----------
const POSTERS = ['dawnstrider', 'starlight-prism', 'petal-cafe-club', 'rift-blade', 'nova-beat', 'lumeria-quest', 'relay-rush', 'spooky-share-house'];
const BANNERS = ['banner-wave', 'banner-jump', 'banner-moon'];
const MENU_ITEMS = ['SHOYU RAMEN', 'MISO RAMEN', 'TONKOTSU RAMEN', 'SPICY RAMEN', 'GYOZA', 'KARAAGE'];
const MENU_PRICES = MENU_ITEMS.map(s => `price-${s.toLowerCase().replace(/ /g, '-')}`);
const PRINTS = {'print-kumako': [32, 31, 614, 615], 'print-magical-girl': [639, 31, 1221, 615], 'print-swordsman': [32, 638, 614, 1222], 'print-ghost': [639, 638, 1221, 1222]};
const PRICE_BOXES = [[79, 538, 490, 576], [573, 539, 966, 577], [1049, 538, 1458, 576], [78, 943, 491, 982], [572, 944, 966, 982], [1048, 944, 1458, 983]];
const ATLASES = [
  {key: 'conPosters', file: 'skyways-con-posters', width: 2048, height: 1536,
    use: 'Skyways convention add-on: the eight series posters (512 x 768 each, 2:3, 4 x 2 grid)',
    slots: POSTERS.map((piece, i) => ({name: piece, piece, x: (i % 4) * 512, y: Math.floor(i / 4) * 768, w: 512, h: 768})),
    groups: {SKYWAYS_CON_POSTERS: POSTERS}},
  {key: 'conBanners', file: 'skyways-con-banners', width: 1536, height: 1219,
    use: 'Skyways convention add-on: three tall hanging banners (512 x 1219 each, 1:2.38: the painted strip of each 2:3 source, centred)',
    slots: BANNERS.map((piece, i) => ({name: piece, piece, x: i * 512, y: 0, w: 512, h: 1219})),
    groups: {SKYWAYS_CON_BANNERS: BANNERS}},
  {key: 'conStage', file: 'skyways-con-stage', width: 1536, height: 1024,
    use: 'Skyways convention add-on: the main-stage backdrop (as generated, 3:2)',
    slots: [{name: 'backdrop', piece: 'backdrop', x: 0, y: 0, w: 1536, h: 1024}]},
  {key: 'conSigns', file: 'skyways-con-signs', width: 1920, height: 768,
    use: 'Skyways convention add-on: the welcome sign (1152 x 768) and the merch-table prints sheet (768 x 768; one UV rect per print card)',
    slots: [{name: 'welcome', piece: 'welcome', x: 0, y: 0, w: 1152, h: 768},
      {name: 'prints', piece: 'prints', x: 1152, y: 0, w: 768, h: 768, sub: PRINTS}],
    groups: {SKYWAYS_CON_PRINTS: Object.keys(PRINTS)}},
  {key: 'prizeBoard', file: 'skyways-prize-board', width: 1024, height: 683,
    use: 'Skyways prize-car add-on: the prize-draw promo board (a display prize only; it never says the car can be driven or entered)',
    slots: [{name: 'board', piece: 'board', x: 0, y: 0, w: 1024, h: 683}]},
  {key: 'ramenArt', file: 'skyways-ramen-art', width: 1536, height: 1366,
    use: 'Skyways ramen restaurant: noren curtain (1024 x 683), illustrated menu board (1024 x 683; NO prices in the art: one UV rect per empty price strip, prices are drawn at runtime) and promo poster (512 x 768)',
    slots: [{name: 'noren', piece: 'noren', x: 0, y: 0, w: 1024, h: 683},
      {name: 'menu', piece: 'menu', x: 0, y: 683, w: 1024, h: 683, sub: Object.fromEntries(MENU_PRICES.map((n, i) => [n, PRICE_BOXES[i]]))},
      {name: 'poster', piece: 'poster', x: 1024, y: 0, w: 512, h: 768}],
    groups: {SKYWAYS_RAMEN_MENU_ITEMS: MENU_ITEMS, SKYWAYS_RAMEN_MENU_PRICES: MENU_PRICES}},
];

// ---------- helpers ----------
/** The largest rect of `aspect` (w / h) inside srcW x srcH, centred on focus (fractions), clamped inside the image. */
function coverRect(srcW, srcH, aspect, focus = [0.5, 0.5]) {
  let w = srcW, h = Math.round(srcW / aspect);
  if (h > srcH) { h = srcH; w = Math.round(srcH * aspect); }
  const x = Math.min(srcW - w, Math.max(0, Math.round(focus[0] * srcW - w / 2)));
  const y = Math.min(srcH - h, Math.max(0, Math.round(focus[1] * srcH - h / 2)));
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
    const crop = coverRect(s.meta.width, s.meta.height, slot.w / slot.h, s.focus);
    const img = await sharp(s.buf).removeAlpha().toColourspace('srgb').extract({left: crop.x, top: crop.y, width: crop.w, height: crop.h})
      .resize(slot.w, slot.h, {kernel: 'lanczos3', fit: 'fill'}).png().toBuffer();
    layers.push({input: img, left: slot.x, top: slot.y});
    pieces[slot.name] = uvOf(slot.x, slot.y, slot.w, slot.h, a.width, a.height);
    const subs = [];
    for (const [subName, b] of Object.entries(slot.sub ?? {})) {
      // source px -> atlas px through the crop + resize
      const sx = slot.w / crop.w, sy = slot.h / crop.h;
      const x0 = slot.x + (b[0] - crop.x) * sx, y0 = slot.y + (b[1] - crop.y) * sy;
      const x1 = slot.x + (b[2] - crop.x) * sx, y1 = slot.y + (b[3] - crop.y) * sy;
      const px = {x: Math.round(x0), y: Math.round(y0), w: Math.round(x1) - Math.round(x0), h: Math.round(y1) - Math.round(y0)};
      if (px.x < slot.x || px.y < slot.y || px.x + px.w > slot.x + slot.w || px.y + px.h > slot.y + slot.h || px.w < 8 || px.h < 8) fail(`${a.key}/${subName}: outside its slot`);
      pieces[subName] = uvOf(px.x, px.y, px.w, px.h, a.width, a.height);
      subs.push({name: subName, placed: px, sourceBox: b});
    }
    provPieces.push({name: slot.name, subject: s.subject,
      codex: {generator: GENERATOR, ledgerCall: s.call, session: s.session, requested: s.intentT, finished: s.resultT, seconds: s.seconds},
      prompt: {file: s.promptFile, sha256: s.promptSha256},
      source: {file: s.rawFile, sha256: s.sha256, bytes: s.rawBytes, width: s.meta.width, height: s.meta.height},
      crop, placed: {x: slot.x, y: slot.y, w: slot.w, h: slot.h}, ...(subs.length ? {subPieces: subs} : {})});
  }
  const jpg = await sharp({create: {width: a.width, height: a.height, channels: 3, background: FILL}}).composite(layers)
    .toColourspace('srgb').jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const m = await sharp(jpg).metadata();
  if (m.width !== a.width || m.height !== a.height || m.format !== 'jpeg') fail(`${a.key}: bad atlas ${m.width}x${m.height} ${m.format}`);
  const rel = `${OUT_DIR_REL}/${a.file}.jpg`, provRel = `${PROV_DIR_REL}/${a.file}.json`;
  const prov = {schema: 'last-line-derivative/1', asset: a.file, task: TASK, lane: 'ART',
    status: "runtime derivative (crop / resize / atlas pack only) of ORIGINAL static artwork generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit authorization for Skyways art (no numerical image cap, user override); invented characters, titles and brand names; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
    use: a.use,
    rebuild: 'node tools/asset-pipeline/props/build-skyways-art.mjs',
    rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-exec-<id>.png, prompts/art-<nn>.txt} (private, outside Git)`,
    generator: GENERATOR,
    recipe: {crop: 'centred cover crop to the slot aspect (focus per piece)', resize: {kernel: 'lanczos3', fit: 'fill'}, colour: 'sRGB, alpha removed',
      pack: `atlas ${a.width}x${a.height}, empty area rgb(${FILL.r},${FILL.g},${FILL.b})`, encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
      uv: 'three.js convention (v = 0 at the image bottom), each rect inset by half a texel', tool: 'sharp (libvips) via tools/asset-pipeline/props/build-skyways-art.mjs'},
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
const ts = [
  `// GENERATED by tools/asset-pipeline/props/build-skyways-art.mjs — do not edit (task ${TASK}, lane ART).`,
  "// The Skyways level's ORIGINAL Codex-generated artwork packed into JPEG atlases (crop / resize / pack only): the anime convention add-on",
  '// (posters, banners, stage backdrop, welcome sign, merch prints), the prize-car add-on\'s prize-draw board and the ramen restaurant\'s',
  '// noren / menu / poster (the menu carries NO prices: those are drawn at runtime). Provenance assets/derivatives/skyways-<atlas>.json.',
  '// UVs: three.js convention (v = 0 at the image bottom, flipY textures), each rect inset by half a texel; aspect = width / height.',
  'export interface SkywaysArtPiece { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number; readonly aspect: number }',
  'export interface SkywaysArtAtlas { readonly url: string; readonly width: number; readonly height: number; readonly pieces: Readonly<Record<string, SkywaysArtPiece>> }',
  'export const SKYWAYS_ART = {',
  ...tsAtlases.map(a => [`  ${a.key}: {url: '${a.url}', width: ${a.width}, height: ${a.height}, pieces: {`,
    ...Object.entries(a.pieces).map(([n, p]) => `    '${n}': ${fmtPiece(p)},`), '  }},'].join('\n')),
  '} as const satisfies Readonly<Record<string, SkywaysArtAtlas>>;',
  'export type SkywaysArtAtlasKey = keyof typeof SKYWAYS_ART;',
  ...ATLASES.filter(a => a.groups).flatMap(a => Object.entries(a.groups).map(([g, names]) => `export const ${g} = [${names.map(n => `'${n}'`).join(', ')}] as const;`)),
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
  console.log('build-skyways-art: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);

fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), ts);
fs.writeFileSync(ALLOW, allowText);
console.log('build-skyways-art: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
