#!/usr/bin/env node
// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): COOKS Northern Groove Records' Codex art into the two runtime
// atlases — deterministic crop / resize / pack only (root CLAUDE.md "processing is not authoring"; nothing is drawn here):
//  - music-covers.jpg (2048 x 2048): the 64 fictional LP covers of the four Codex cover sheets (4 x 4 each), cropped out of their black
//    gutters (detected on the pixels), 248 px each in an 8 x 8 grid of 256 px cells (4 px edge-extended padding against mip bleed);
//    cover index = sheet * 16 + row * 4 + column;
//  - music-signs.jpg (2048 x 1152): the four gig posters (2 x 2 Codex sheet), the NEW ARRIVALS / LISTENING BOOTHS boards and the eight
//    genre cards of the Codex sign sheet (found as the non-black rectangles on its black ground), each at its own aspect.
// Writes the atlas table game/src/gen/skyways/stores/musicArt.ts (piece rects, three.js UVs: v = 0 at the image bottom) and the
// provenance record game/public/assets/derivatives/skyways-store-art-20261107.json. The raw Codex originals stay private in the
// raw backup (never in Git): reference/tasks/skyways-rework-20261107-054512/shops/music/codex/ (receipts with session ids / prompts).
//
// usage: node tools/asset-pipeline/skyways-stores/music/build-music-art.mjs [--raw <dir with covers-1..4.png, posters.png, signs.png>]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {STORE_ART_PROV_REL, storeProvenanceBuffer} from '../storeProvenance.mjs'; // (primary, integration: one combined store-art provenance record)

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
const RAW = path.resolve(args.includes('--raw') ? args[args.indexOf('--raw') + 1] : path.join(ROOT, '../../..', 'reference/tasks/skyways-rework-20261107-054512/shops/music/codex'));
const OUT_DIR = path.join(ROOT, 'game/public/assets/textures/skyways/stores/music');
const TABLE = path.join(ROOT, 'game/src/gen/skyways/stores/musicArt.ts');
const PROV = path.join(ROOT, 'game/public', STORE_ART_PROV_REL);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const JPEG = {quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0'};

async function rgb(file) {
  const {data, info} = await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {data, w: info.width, h: info.height};
}
const lum = (im, x, y) => { const i = (y * im.w + x) * 3; return 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]; };
/** Brightest channel (a dark burgundy board is not the black ground). */
const peak = (im, x, y) => { const i = (y * im.w + x) * 3; return Math.max(im.data[i], im.data[i + 1], im.data[i + 2]); };

/** Runs of indices where pred(i) holds (inclusive [a, b]). */
function runs(n, pred) {
  const out = [];
  let a = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pred(i);
    if (on && a < 0) a = i;
    if (!on && a >= 0) { out.push([a, i - 1]); a = -1; }
  }
  return out;
}
/** The `n` content cells along an axis between the dark gutter lines (columns / rows that are >= 85 % near-black). */
function gridCells(im, axis, n) {
  const len = axis === 'x' ? im.w : im.h, across = axis === 'x' ? im.h : im.w;
  const dark = new Float32Array(len);
  for (let i = 0; i < len; i++) { let k = 0; for (let j = 0; j < across; j += 2) if ((axis === 'x' ? lum(im, i, j) : lum(im, j, i)) < 30) k++; dark[i] = k / Math.ceil(across / 2); }
  const cells = runs(len, i => dark[i] < 0.85).filter(([a, b]) => b - a > len / n * 0.6);
  if (cells.length !== n) throw new Error(`${axis}: expected ${n} cells between gutters, found ${cells.length} (${JSON.stringify(cells)})`);
  return cells;
}
/** Non-black rectangles of a sign sheet: row bands, then column segments in each (tight bounds). */
function signRects(im) {
  const rowOn = i => { let k = 0; for (let x = 0; x < im.w; x += 2) if (peak(im, x, i) > 40) k++; return k > 8; };
  const bands = runs(im.h, rowOn).filter(([a, b]) => b - a > 30);
  const out = [];
  for (const [y0, y1] of bands) {
    const colOn = x => { let k = 0; for (let y = y0; y <= y1; y += 2) if (peak(im, x, y) > 40) k++; return k > 4; };
    for (const [x0, x1] of runs(im.w, colOn).filter(([a, b]) => b - a > 30)) out.push({x0, y0, x1, y1});
  }
  return out;
}

async function crop(file, r, inset, w, h) {
  const iw = r.x1 - r.x0 + 1, ih = r.y1 - r.y0 + 1, dx = Math.round(iw * inset), dy = Math.round(ih * inset);
  return sharp(file).removeAlpha().extract({left: r.x0 + dx, top: r.y0 + dy, width: iw - 2 * dx, height: ih - 2 * dy}).resize(w, h, {fit: 'fill', kernel: 'lanczos3'})
    .extend({top: 4, bottom: 4, left: 4, right: 4, extendWith: 'copy'}).raw().toBuffer();
}

const raws = {};
for (const f of ['covers-1', 'covers-2', 'covers-3', 'covers-4', 'posters', 'signs']) {
  const file = path.join(RAW, `${f}.png`), bytes = fs.readFileSync(file), meta = await sharp(file).metadata();
  const receipt = JSON.parse(fs.readFileSync(path.join(RAW, `${f}.receipt.json`), 'utf8'));
  const out = receipt.outputs[0];
  if (out.sha256 !== sha(bytes)) throw new Error(`${f}: raw sha256 differs from its receipt`);
  raws[f] = {file, sha256: sha(bytes), bytes: bytes.length, width: meta.width, height: meta.height, session: out.session, nativeOutput: path.basename(out.source), prompt: receipt.prompt, seconds: receipt.seconds};
}

// --- covers atlas ---
const CELL = 256, GRID = 8, C = CELL - 8;
const composites = [];
const coverSrc = [];
for (let s = 0; s < 4; s++) {
  const r = raws[`covers-${s + 1}`], im = await rgb(r.file);
  const xs = gridCells(im, 'x', 4), ys = gridCells(im, 'y', 4);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const idx = s * 16 + j * 4 + i, rect = {x0: xs[i][0], x1: xs[i][1], y0: ys[j][0], y1: ys[j][1]};
    const buf = await crop(r.file, rect, 0.012, C, C);
    composites.push({input: buf, raw: {width: CELL, height: CELL, channels: 3}, left: (idx % GRID) * CELL, top: Math.floor(idx / GRID) * CELL});
    coverSrc.push({index: idx, sheet: `covers-${s + 1}`, rect});
  }
}
fs.mkdirSync(OUT_DIR, {recursive: true});
const coversJpg = await sharp({create: {width: GRID * CELL, height: GRID * CELL, channels: 3, background: {r: 0, g: 0, b: 0}}}).composite(composites).jpeg(JPEG).toBuffer();
fs.writeFileSync(path.join(OUT_DIR, 'music-covers.jpg'), coversJpg);

// --- signs atlas: posters, the two boards, the eight genre cards ---
const SW = 2048, SH = 1152, pieces = {}, signComp = [], signSrc = [];
const place = async (name, file, rect, x, y, w, h, inset) => {
  signComp.push({input: await crop(file, rect, inset, w, h), raw: {width: w + 8, height: h + 8, channels: 3}, left: x - 4, top: y - 4});
  pieces[name] = {u0: +(x / SW).toFixed(6), v0: +(1 - (y + h) / SH).toFixed(6), u1: +((x + w) / SW).toFixed(6), v1: +(1 - y / SH).toFixed(6), aspect: +(((rect.x1 - rect.x0 + 1)) / (rect.y1 - rect.y0 + 1)).toFixed(4)};
  signSrc.push({piece: name, sheet: path.basename(file, '.png'), rect});
};
{
  const r = raws.posters, im = await rgb(r.file);
  const xs = gridCells(im, 'x', 2), ys = gridCells(im, 'y', 2);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) await place(`poster-${j * 2 + i}`, r.file, {x0: xs[i][0], x1: xs[i][1], y0: ys[j][0], y1: ys[j][1]}, (j * 2 + i) * 512 + 4, 4, 504, 760, 0.006);
}
{
  const r = raws.signs, im = await rgb(r.file), rects = signRects(im);
  if (rects.length !== 10) throw new Error(`signs: expected 10 rectangles, found ${rects.length}`);
  const names = ['new-arrivals', 'listening-booths', 'genre-rock', 'genre-jazz', 'genre-folk', 'genre-soul', 'genre-punk', 'genre-country', 'genre-blues', 'genre-electronic'];
  for (let k = 0; k < 2; k++) {
    const q = rects[k], a = (q.x1 - q.x0 + 1) / (q.y1 - q.y0 + 1), w = 1016, h = Math.round(w / a);
    await place(names[k], r.file, q, k * 1024 + 4, 772, w, h, 0);
  }
  for (let k = 2; k < 10; k++) {
    const q = rects[k], a = (q.x1 - q.x0 + 1) / (q.y1 - q.y0 + 1), w = 248, h = Math.round(w / a);
    await place(names[k], r.file, q, (k - 2) * 256 + 4, 972, w, h, 0);
  }
}
const signsJpg = await sharp({create: {width: SW, height: SH, channels: 3, background: {r: 0, g: 0, b: 0}}}).composite(signComp).jpeg(JPEG).toBuffer();
fs.writeFileSync(path.join(OUT_DIR, 'music-signs.jpg'), signsJpg);

// --- the table ---
const url = f => `assets/textures/skyways/stores/music/${f}`;
const table = `// GENERATED by tools/asset-pipeline/skyways-stores/music/build-music-art.mjs (task studio-alpha-skyways-shops-20261107-054512-01, lane
// STORE-MUSIC) — do not edit by hand. Northern Groove Records' Codex art atlases (crop / pack only; provenance:
// game/public/assets/derivatives/skyways-store-art-20261107.json). UV rects in three.js convention (v = 0 at the image bottom).

export interface MusicArtRect { u0: number; v0: number; u1: number; v1: number; aspect: number }
export const MUSIC_ART = {
  covers: {url: '${url('music-covers.jpg')}', width: ${GRID * CELL}, height: ${GRID * CELL}, grid: ${GRID}, cell: ${CELL}, pad: 4, count: 64, sha256: '${sha(coversJpg)}'},
  signs: {url: '${url('music-signs.jpg')}', width: ${SW}, height: ${SH}, sha256: '${sha(signsJpg)}', pieces: {
${Object.entries(pieces).map(([k, v]) => `    '${k}': ${JSON.stringify(v).replace(/"/g, '')},`).join('\n')}
  } as Readonly<Record<string, MusicArtRect>>},
} as const;
`;
fs.writeFileSync(TABLE, table);

// --- provenance ---
const prov = {
  schema: 'last-line-derivative/1',
  asset: 'skyways-store-music-art-20261107',
  task: 'studio-alpha-skyways-shops-20261107-054512-01',
  lane: 'STORE-MUSIC (Skyways major store: Northern Groove Records)',
  status: 'runtime derivatives (crop / resize / pack only) of SIX static art sheets generated for this project with Codex native image_gen (owned Codex CLI, codex exec -> built-in image_gen) under the store brief\'s authorization (Codex image-gen for the stores\' wall / sign / record-cover art, no numerical cap; 6 accepted of 6 attempts); fictional covers / bands / venues, no real artists or trademarks requested; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  use: 'game/src/world/skywaysStoreMusic.ts: LP sleeve faces in the record-bin stock / faced-out new-arrivals ledges (covers atlas), gig posters, the NEW ARRIVALS / LISTENING BOOTHS boards and the bin genre cards (signs atlas)',
  rebuild: 'node tools/asset-pipeline/skyways-stores/music/build-music-art.mjs --raw <raw dir>',
  rawStorage: 'reference/tasks/skyways-rework-20261107-054512/shops/music/codex/{covers-1..4,posters,signs}.png + <job>.receipt.json (prompt, Codex session id, native output, sha256) + attempts.log + prompts.json + run_codex.py (private raw backup, outside Git)',
  generator: 'Codex native image_gen (owned Codex CLI 0.163.0)',
  recipe: {
    covers: {detect: 'black gutter lines (columns / rows >= 85 % near-black) -> 4 x 4 cells per sheet', crop: 'cell inset 1.2 %', resize: '248 x 248 lanczos3 (fill)', pad: '4 px edge-extend (copy)', atlas: '8 x 8 cells of 256 px, cover index = sheet * 16 + row * 4 + column'},
    signs: {detect: 'posters: black gutters (2 x 2); signs: non-black rectangles on the black ground (row bands, then column runs)', posters: '504 x 760 each (inset 0.6 %)', boards: '1016 px wide at their own aspect', cards: '248 px wide at their own aspect', pad: '4 px edge-extend (copy)'},
    encode: {format: 'jpeg', quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0', metadata: 'stripped'},
    tool: 'sharp (libvips)',
  },
  sources: Object.fromEntries(Object.entries(raws).map(([k, v]) => [k, {file: `${k}.png`, sha256: v.sha256, bytes: v.bytes, width: v.width, height: v.height, codex: {session: v.session, nativeOutput: v.nativeOutput, seconds: v.seconds}, prompt: v.prompt}])),
  files: [
    {file: 'textures/skyways/stores/music/music-covers.jpg', sha256: sha(coversJpg), bytes: coversJpg.length, width: GRID * CELL, height: GRID * CELL, cells: coverSrc},
    {file: 'textures/skyways/stores/music/music-signs.jpg', sha256: sha(signsJpg), bytes: signsJpg.length, width: SW, height: SH, pieces: signSrc},
  ],
};
fs.writeFileSync(PROV, storeProvenanceBuffer('music', prov));
console.log(`covers ${coversJpg.length} B, signs ${signsJpg.length} B; pieces ${Object.keys(pieces).join(' ')}`);
