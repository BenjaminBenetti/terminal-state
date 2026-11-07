// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): cooks the Larch & Loom Home FRAMED ART PRINTS from the one
// Codex original (native image_gen, owned Codex CLI: a 3 x 2 sheet of six portrait artworks on white) — DETERMINISTIC PROCESSING ONLY:
// find the six artworks on the white sheet (row / column projections of near-white pixels), crop each a few pixels inside its edge,
// resize (lanczos3, cover to the artworks' own portrait aspect), pack into one 3 x 2 JPEG atlas. Writes:
//  - game/public/assets/textures/skyways/stores/design/skyways-store-design-prints.jpg (the runtime atlas),
//  - game/src/gen/skyways/stores/designArt.ts (its URL / size / per-piece UV rects, three.js convention: v = 0 at the image bottom),
//  - game/public/assets/derivatives/skyways-store-design-art-20261107.json (provenance: source sha, prompt, Codex receipt, recipe, output).
// The raw original, prompt, receipt and session stay in the private raw backup (reference/tasks/skyways-rework-20261107-054512/shops/
// design/codex/, outside Git; never overwritten).
// Usage: node tools/asset-pipeline/skyways-stores/design/build-art.mjs [RAW_DIR]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const raw = process.argv[2] ?? path.join(root, '../../../reference/tasks/skyways-rework-20261107-054512/shops/design/codex');
const rawDir = fs.existsSync(raw) ? raw : '/workspaces/subway-game/reference/tasks/skyways-rework-20261107-054512/shops/design/codex';
const SRC = path.join(rawDir, 'design-prints-original.png');
const receipt = JSON.parse(fs.readFileSync(path.join(rawDir, 'receipt.json'), 'utf8'));
const prompt = fs.readFileSync(path.join(rawDir, 'prompt.txt'), 'utf8').trim();
const URL = 'assets/textures/skyways/stores/design/skyways-store-design-prints.jpg';
const OUT = path.join(root, 'game/public', URL);
const TABLE = path.join(root, 'game/src/gen/skyways/stores/designArt.ts');
const PROV = path.join(root, 'game/public/assets/derivatives/skyways-store-design-art-20261107.json');
const PW = 332, PH = 576, COLS = 3, ROWS = 2, INSET = 8;
const SUBJECTS = ['mid-century abstract arches and circles (sage, ochre, terracotta, cream)', 'ink line drawing of a prairie horizon with a low winter sun',
  'botanical study of larch branches with cones', 'woven-textile geometric pattern (oatmeal, charcoal, rust)', 'watercolour of a northern lake with birch trees',
  'Scandinavian graphic of stacked organic shapes (mustard, dusty blue, charcoal)'];

const srcBuf = fs.readFileSync(SRC);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
if (sha(srcBuf) !== receipt.nativeSha256) throw new Error('raw original does not match the Codex receipt');
const {data, info} = await sharp(srcBuf).removeAlpha().raw().toBuffer({resolveWithObject: true});
const W = info.width, H = info.height, C = info.channels;
const white = (x, y) => { const i = (y * W + x) * C; return data[i] > 238 && data[i + 1] > 238 && data[i + 2] > 238; };
/** Runs of non-white lines (rows: over x in [x0, x1); cols: over y in [y0, y1)), as [start, end) with a min length. */
function bands(n, isWhiteLine, min = 40) {
  const out = [];
  let s = -1;
  for (let k = 0; k <= n; k++) {
    const w = k === n || isWhiteLine(k);
    if (!w && s < 0) s = k;
    if (w && s >= 0) { if (k - s >= min) out.push([s, k]); s = -1; }
  }
  return out;
}
const rowWhite = y => { let n = 0; for (let x = 0; x < W; x += 2) if (!white(x, y)) n++; return n < W / 2 * 0.01; };
const rows = bands(H, rowWhite);
if (rows.length !== ROWS) throw new Error(`expected ${ROWS} artwork rows, found ${rows.length}: ${JSON.stringify(rows)}`);
const boxes = [];
for (const [y0, y1] of rows) {
  const colWhite = x => { let n = 0; for (let y = y0; y < y1; y += 2) if (!white(x, y)) n++; return n < (y1 - y0) / 2 * 0.01; };
  const cols = bands(W, colWhite);
  if (cols.length !== COLS) throw new Error(`expected ${COLS} artworks in row ${y0}-${y1}, found ${cols.length}: ${JSON.stringify(cols)}`);
  for (const [x0, x1] of cols) boxes.push({x0, y0, x1, y1});
}
const tiles = [];
for (const b of boxes) {
  const left = b.x0 + INSET, top = b.y0 + INSET, width = b.x1 - b.x0 - 2 * INSET, height = b.y1 - b.y0 - 2 * INSET;
  tiles.push(await sharp(srcBuf).removeAlpha().extract({left, top, width, height}).resize(PW, PH, {fit: 'cover', position: 'centre', kernel: 'lanczos3'}).raw().toBuffer());
}
const AW = PW * COLS, AH = PH * ROWS;
const atlas = await sharp({create: {width: AW, height: AH, channels: 3, background: {r: 255, g: 255, b: 255}}})
  .composite(tiles.map((t, i) => ({input: t, raw: {width: PW, height: PH, channels: 3}, left: (i % COLS) * PW, top: Math.floor(i / COLS) * PH})))
  .jpeg({quality: 86, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, atlas);
const r6 = v => Math.round(v * 1e6) / 1e6;
const pieces = tiles.map((_, i) => {
  const c = i % COLS, r = Math.floor(i / COLS);
  // (half a texel inset; v from the image bottom)
  return {u0: r6((c * PW + 0.5) / AW), v0: r6(1 - ((r + 1) * PH - 0.5) / AH), u1: r6(((c + 1) * PW - 0.5) / AW), v1: r6(1 - (r * PH + 0.5) / AH)};
});
const ts = `// GENERATED by tools/asset-pipeline/skyways-stores/design/build-art.mjs — do not edit (task studio-alpha-skyways-shops-20261107-054512-01,
// lane STORE-DESIGN). The Larch & Loom Home framed art prints: six ORIGINAL Codex-generated artworks (native image_gen, one 3 x 2 sheet)
// cropped / resized / packed into one JPEG atlas (deterministic processing only). Provenance assets/derivatives/skyways-store-design-art-20261107.json.
// UVs: three.js convention (v = 0 at the image bottom, flipY textures), each rect inset by half a texel; every piece is a portrait of DESIGN_ART.aspect (w / h).
export interface DesignArtPiece { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }
export const DESIGN_ART: {readonly url: string; readonly width: number; readonly height: number; readonly aspect: number; readonly pieces: readonly DesignArtPiece[]} = {
  url: '${URL}', width: ${AW}, height: ${AH}, aspect: ${r6(PW / PH)},
  pieces: [
${pieces.map((p, i) => `    {u0: ${p.u0}, v0: ${p.v0}, u1: ${p.u1}, v1: ${p.v1}}, // ${i}: ${SUBJECTS[i]}`).join('\n')}
  ],
};
`;
fs.writeFileSync(TABLE, ts);
const srcMeta = await sharp(srcBuf).metadata();
const prov = {
  schema: 'last-line-derivative/1',
  asset: 'skyways-store-design-art-20261107',
  task: 'studio-alpha-skyways-shops-20261107-054512-01',
  lane: 'STORE-DESIGN (Skyways major store: Larch & Loom Home)',
  status: 'runtime derivative of SIX static framed-art-print artworks generated for this project with Codex native image_gen (owned Codex CLI) in ONE call (1 accepted of 1 attempt) under the store lanes\' authorization (COMMON brief: Codex art for the store\'s wall / sign / poster / cover art, economical); provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  use: 'game/src/world/skywaysStoreDesignDraw.ts: the skyDsArtPrint framed prints (pale-oak frame + white mat drawn as boxes, the art face one atlas piece each; loaded behind the loading screen by world/skywaysStoreDesignRuntime.ts; without the atlas a plain board)',
  rebuild: 'node tools/asset-pipeline/skyways-stores/design/build-art.mjs',
  rawStorage: 'reference/tasks/skyways-rework-20261107-054512/shops/design/codex/{design-prints-original.png, receipt.json, prompt.txt, instruction.txt, attempts.log, codex-session.jsonl, SOURCES-SHA256.txt} (read-only raw master, outside Git)',
  generator: 'Codex native image_gen (owned Codex CLI)',
  source: {file: 'design-prints-original.png', sha256: sha(srcBuf), bytes: srcBuf.length, width: srcMeta.width, height: srcMeta.height, channels: srcMeta.channels, hasAlpha: !!srcMeta.hasAlpha},
  codex: {generator: receipt.generator, threadId: receipt.threadId, nativeOutput: path.basename(receipt.nativeOutput), nativeSha256Matches: receipt.nativeSha256 === sha(srcBuf), exit: receipt.exit, launched: receipt.launched, finished: receipt.finished, agentModel: 'gpt-6.1-sol (session rollout; the image model id is not reported)'},
  prompt,
  recipe: {
    find: 'the six artworks: row then column projections of near-white pixels (all channels > 238; a line is white when < 1 % of its sampled pixels are not), 2 rows x 3 columns',
    crop: `${INSET} px inside each artwork's edge`,
    resize: {width: PW, height: PH, fit: 'cover (centre) to the sheet\'s own ~0.58 portrait aspect (a few px trimmed)', kernel: 'lanczos3'},
    pack: {layout: `${COLS} x ${ROWS}`, width: AW, height: AH, order: 'row-major as on the sheet'},
    colour: 'sRGB, alpha none',
    encode: {format: 'jpeg', quality: 86, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    tool: 'sharp (libvips) via tools/asset-pipeline/skyways-stores/design/build-art.mjs',
  },
  pieces: boxes.map((b, i) => ({index: i, subject: SUBJECTS[i], sourceBox: b, uv: pieces[i]})),
  output: {url: URL, bytes: atlas.length, sha256: sha(atlas), width: AW, height: AH, format: 'jpeg'},
};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log(JSON.stringify({rows, boxes, out: OUT, bytes: atlas.length, sha256: sha(atlas)}, null, 1));
