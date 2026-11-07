// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): runtime derivative of the Aurora Picture House's Codex-generated
// ORIGINAL flat artwork — four invented now-showing film posters (the lobby's poster cases / stands) and the concession's REFRESHMENTS
// board. Root CLAUDE.md "Textures — Codex for INITIAL sources": every source is ONE Codex native image_gen call (owned Codex CLI, the
// user's explicit store-art authorization for this task); nothing hand-drawn. Processing only: crop (to the slot aspect, centred) /
// resize (sharp lanczos3) / pack into one JPEG atlas.
//
// Reads (never modifies) the private raw backup OUTSIDE Git:
//   reference/tasks/skyways-rework-20261107-054512/shops/cinema/codex/{LEDGER.jsonl, raw/<name>-<session>-exec-<id>.png, prompts/<name>.txt}
// and writes deterministically:
//   game/public/assets/textures/skyways/stores/cinema/cinema-art.jpg        sRGB JPEG atlas (mozjpeg q85, 4:2:0, metadata stripped)
//   game/public/assets/derivatives/skyways-store-art-20261107.json   provenance (sessions, prompt + raw sha256s, rects; no local paths)
//   game/src/gen/skyways/stores/cinemaArt.generated.ts                       atlas url / size / per-piece UV rects (three.js convention)
// (tools/release/public-inputs.json is updated separately: --allowlist prints the two public entries.)
//
// Usage: node tools/asset-pipeline/skyways-stores/cinema/build-art.mjs [--check] [--allowlist] [--task-dir=<private cinema folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {STORE_ART_PROV_REL, storeProvenanceBuffer} from '../storeProvenance.mjs'; // (primary, integration: one combined store-art provenance record)

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../../..');
const TASK = 'studio-alpha-skyways-shops-20261107-054512-01';
const TASK_REL = 'reference/tasks/skyways-rework-20261107-054512/shops/cinema/codex';
const PUB = path.join(root, 'game/public');
const ATLAS_REL = 'assets/textures/skyways/stores/cinema/cinema-art.jpg';
const PROV_REL = STORE_ART_PROV_REL;
const TS_REL = 'game/src/gen/skyways/stores/cinemaArt.generated.ts';
const QUALITY = 85;
const FILL = {r: 24, g: 20, b: 22};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-art (cinema): ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 6; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL} (raw Codex outputs live outside Git; pass --task-dir=)`);
}

// The accepted Codex outputs: ledger name -> atlas piece, subject, slot. All five were accepted at their first call (title / tagline
// text checked letter by letter; no real films, studios, actors or brands), so none was rejected or retried.
const SOURCES = [
  {name: 'cinema-p1', piece: 'coulee', subject: 'film poster: invented 1950s western "THE COULEE KID" (tagline "SHOWDOWN AT DRY CREEK")'},
  {name: 'cinema-p2', piece: 'hoppers', subject: 'film poster: invented 1950s creature feature "THE HOPPERS" (tagline "THEY CAME WITH THE HARVEST")'},
  {name: 'cinema-p3', piece: 'midway', subject: 'film poster: invented 1950s musical "Moonlight on the Midway" (tagline "SONGS! LAUGHS! ROMANCE!")'},
  {name: 'cinema-p4', piece: 'skywalk', subject: 'film poster: invented 1940s film noir "SKYWALK AT MIDNIGHT" (tagline "SOMEONE KNOWS TOO MUCH")'},
  {name: 'cinema-menu', piece: 'refreshments', subject: 'concession board: art-deco "REFRESHMENTS" panel with popcorn, soda, candy, chocolate, hot dog, ice cream'},
];
// Atlas: the four posters 512 x 768 (2:3) across the top, the board 960 x 640 (3:2) below.
const W = 2048, H = 1408;
const SLOTS = {coulee: [0, 0, 512, 768], hoppers: [512, 0, 512, 768], midway: [1024, 0, 512, 768], skywalk: [1536, 0, 512, 768], refreshments: [0, 768, 960, 640]};

const dir = taskDir();
const ledger = fs.readFileSync(path.join(dir, 'LEDGER.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const r6 = v => Math.round(v * 1e6) / 1e6;

const files = [];
const comps = [];
const pieces = {};
for (const s of SOURCES) {
  const res = ledger.filter(r => r.kind === 'result' && r.name === s.name && r.rc === 0 && r.outputs?.length === 1);
  if (res.length !== 1) fail(`${s.name}: expected exactly one accepted result row, got ${res.length}`);
  const out = res[0].outputs[0];
  const intent = ledger.filter(r => r.kind === 'intent' && r.name === s.name);
  const raw = fs.readFileSync(path.join(dir, 'raw', out.file));
  if (sha(raw) !== out.sha256) fail(`${s.name}: raw sha256 mismatch`);
  const prompt = fs.readFileSync(path.join(dir, 'prompts', `${s.name}.txt`));
  if (sha(prompt) !== intent[0]?.prompt_sha256) fail(`${s.name}: prompt sha256 mismatch`);
  const meta = await sharp(raw).metadata();
  const [sx, sy, sw, shh] = SLOTS[s.piece];
  // centred crop of the source to the slot aspect (the sources are already 2:3 / 3:2: a no-op crop), then lanczos3
  const want = sw / shh, have = meta.width / meta.height;
  const cw = have > want ? Math.round(meta.height * want) : meta.width, ch = have > want ? meta.height : Math.round(meta.width / want);
  const cx = Math.floor((meta.width - cw) / 2), cy = Math.floor((meta.height - ch) / 2);
  const buf = await sharp(raw).extract({left: cx, top: cy, width: cw, height: ch}).resize(sw, shh, {kernel: 'lanczos3', fit: 'fill'}).removeAlpha().toBuffer();
  comps.push({input: buf, left: sx, top: sy});
  const e = 0.5; // half-texel inset
  pieces[s.piece] = {u0: r6((sx + e) / W), v0: r6(1 - (sy + shh - e) / H), u1: r6((sx + sw - e) / W), v1: r6(1 - (sy + e) / H), aspect: r6(sw / shh)};
  files.push({
    id: s.piece, subject: s.subject,
    source: {file: out.file, sha256: out.sha256, bytes: out.bytes, width: meta.width, height: meta.height, hasAlpha: !!meta.hasAlpha},
    codex: {generator: GENERATOR, threadId: out.session, nativeOutput: out.file.slice(out.file.indexOf('exec-')), exit: 0, launched: intent[0].at, seconds: res[0].seconds, attempts: intent.length},
    promptSha256: intent[0].prompt_sha256,
    crop: {x: cx, y: cy, w: cw, h: ch}, slot: {x: sx, y: sy, w: sw, h: shh},
  });
}

const atlas = await sharp({create: {width: W, height: H, channels: 3, background: FILL}}).composite(comps)
  .jpeg({quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();

const prov = {
  schema: 'last-line-derivative/1',
  asset: 'skyways-store-cinema-art-20261107',
  task: TASK,
  lane: 'STORE-CINEMA (Skyways major store "Aurora Picture House")',
  status: 'runtime derivative of FIVE static artworks generated for this project with Codex native image_gen (owned Codex CLI) under the user\'s explicit authorization of Codex store art for the Skyways major stores (5 accepted of 5 attempts); provider terms apply; unapproved prototype, no licence or commercial clearance implied; every film, title and tagline is invented (no real films, studios, actors or brands)',
  use: 'game/src/world/skywaysStoreCinema.ts: the poster cases / poster stands (one poster per variant) and the concession board (gen/skyways/stores/cinemaArt.ts pieces, cropped to the face aspect)',
  rebuild: 'node tools/asset-pipeline/skyways-stores/cinema/build-art.mjs',
  rawStorage: `${TASK_REL}/{raw/<name>-<session>-exec-<id>.png, prompts/<name>.txt, LEDGER.jsonl, runs/rollout-*.jsonl} (read-only raw masters, outside Git)`,
  generator: GENERATOR,
  recipe: {
    crop: 'centred to the slot aspect (sources already 2:3 / 3:2: full frame kept)', resize: {kernel: 'lanczos3', posters: '512 x 768', board: '960 x 640'},
    colour: 'sRGB, alpha none', encode: {format: 'jpeg', quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    tool: 'sharp (libvips) via tools/asset-pipeline/skyways-stores/cinema/build-art.mjs',
  },
  output: {file: ATLAS_REL, width: W, height: H, bytes: atlas.length, sha256: sha(atlas)},
  files,
};
const provText = storeProvenanceBuffer('cinema', prov).toString('utf8');
const ts = `// GENERATED by tools/asset-pipeline/skyways-stores/cinema/build-art.mjs — do not edit (task ${TASK}, lane STORE-CINEMA).
// The Aurora Picture House's ORIGINAL Codex-generated flat artwork packed into one JPEG atlas (crop / resize / pack only): four invented
// now-showing film posters and the concession's REFRESHMENTS board. Provenance assets/derivatives/skyways-store-art-20261107.json.
// UVs: three.js convention (v = 0 at the image bottom, flipY textures), each rect inset by half a texel; aspect = width / height.
export const STORE_CINEMA_ART = {url: '${ATLAS_REL}', width: ${W}, height: ${H}, pieces: {
${Object.entries(pieces).map(([k, r]) => `  ${k}: {u0: ${r.u0}, v0: ${r.v0}, u1: ${r.u1}, v1: ${r.v1}, aspect: ${r.aspect}},`).join('\n')}
}} as const;
`;

const outs = [[path.join(PUB, ATLAS_REL), atlas], [path.join(PUB, PROV_REL), Buffer.from(provText)], [path.join(root, TS_REL), Buffer.from(ts)]];
if (CHECK) {
  let bad = 0;
  for (const [f, b] of outs) if (!fs.existsSync(f) || sha(fs.readFileSync(f)) !== sha(b)) { console.error(`stale: ${path.relative(root, f)}`); bad++; }
  if (bad) process.exit(1);
  console.log('build-art (cinema): up to date');
} else {
  for (const [f, b] of outs) { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, b); console.log(`wrote ${path.relative(root, f)} (${b.length} bytes)`); }
}
if (process.argv.includes('--allowlist')) {
  for (const rel of [ATLAS_REL, PROV_REL]) { const b = fs.readFileSync(path.join(PUB, rel)); console.log(JSON.stringify({path: rel, bytes: b.length, sha256: sha(b)})); }
}
