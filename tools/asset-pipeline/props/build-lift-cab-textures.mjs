// Task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: runtime PBR sets of the Surface Run cargo-lift cab's Codex-generated
// ORIGINAL sources (user: "lift visuals are poor, bad material quality re-texture to make it look good. PBR.") — painted steel wall
// lining, diamond tread deck, hazard striping, the shaft's cast concrete, hardwood bumper boards — and its placard sheet (four labels).
// Root CLAUDE.md "Textures — Codex for INITIAL sources": every colour source is ONE ledgered Codex native image_gen call (the task's private
// runner); nothing here draws. Processing only, deterministic, recorded per set in its provenance 'recipe':
//   a. CROP per axis: a 'periodic' axis (the tread's lug grid, the hazard stripes) is cropped to the most WHOLE periods that fit inside the
//      feather margin — the period measured on the source's own pixels (the autocorrelation peak of the high-passed luminance over pure
//      shifts along that axis, sub-pixel by a parabola); a 'free' axis (paint, concrete, wood: no structure crosses the edges) keeps the
//      frame inside the margin.
//   b. SEAM: the last `featherPx` columns / rows cross-fade (cosine) into the source pixels just before the crop start — the true wrap
//      neighbours of the first column / row (a whole number of periods earlier on a periodic axis).
//   c. resize to 1024 x 1024 (sharp lanczos3, fill) of the 3 x 3 wrap-tiled crop (centre extract: exact wrap filtering).
//   d. HEIGHT (metres, per class: a luminance band-pass at the class' relief amplitude) -> NORMAL (the Reactor kit's convention: R = -dh/dx,
//      G = +dh/dy with image y down, B = z) and ORM (R = AO from cavity, G = roughness in the class range — darker than its surroundings
//      = rougher, B = metalness: the tread's bare steel, less where grime fills it; 0 elsewhere).
//   e. the colour map's LINEAR mean albedo and the ORM's mean roughness go into the generated registry; the placard sheet is a colour atlas
//      (no tiling): its four labels' rectangles are measured on the sheet (pixels unlike the flat background) and listed as UV rects.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/surface-run-lift-reliability-and-cab-20261118-023909/gen/):
//   LEDGER.jsonl (intent + result rows of every Codex call), raw/codex-<n>-<id>-exec-<uuid>.png, prompts/frozen/<id>-c<n>.txt
// and writes deterministically:
//   game/public/assets/textures/lift/lift-cab-<name>-{color,normal,orm}.jpg   1024 x 1024 JPEG (the placards: -color only)
//   game/public/assets/derivatives/lift-cab-<name>.json                        provenance (no prompt text / URLs / local paths)
//   game/src/assets/liftCabTextures.generated.ts                               urls / bytes / span / mean albedo / roughness / label rects
//   game/public/assets/CREDITS.md                                              the marked lift-cab-20261118 section
//   tools/release/public-inputs.json                                           ONLY this script's paths (+ CREDITS.md)
//
// Usage: node tools/asset-pipeline/props/build-lift-cab-textures.mjs [--dry-run | --check] [--task-dir=<private task folder>] [--debug-dir=<dir>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-surface-run-lift-reliability-and-cab-20261118-023909-01';
const TASK_REL = 'reference/tasks/surface-run-lift-reliability-and-cab-20261118-023909';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/lift';
const PROV_DIR_REL = 'assets/derivatives';
const TS_REL = 'game/src/assets/liftCabTextures.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS_BEGIN = '<!-- BEGIN lift-cab-20261118 (build-lift-cab-textures.mjs) -->';
const CREDITS_END = '<!-- END lift-cab-20261118 -->';
const N = 1024;
const Q = {color: 85, normal: 90, orm: 88};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';
const FEATHER = 64;

const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');
const DEBUG_DIR = process.argv.find(a => a.startsWith('--debug-dir='))?.slice('--debug-dir='.length) ?? null;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-lift-cab-textures: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 6; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex sources (one ledgered call each) ----------
// axes: 'free' (no structure crosses the edges: the frame inside the feather margin) | {periods: expected count across the frame} (measured).
// frameM = metres the prompt's frame covers (free axes); periodM = metres one measured period covers (periodic axes: the physical scale).
// relief: [blur px, base px, metres per standard deviation] luminance band-passes summed into the height; rough: [smooth, rough] range;
// ao: [cavity blur px, occlusion per height standard deviation, floor].
const SOURCES = {
  wall: {id: 'cab-wall-paint', call: 1, sha256: 'd8b41758d73696892c12d4f3a626c864e1a02801a70649441dea356a08930bf3', cls: 'paint', u: 'free', v: 'free', frameM: 1.2,
    relief: [[1, 6, 0.00025], [3, 18, 0.0006]], rough: [0.42, 0.72], metal: null, ao: [9, 0.22, 0.55],
    subject: 'painted steel freight-cab wall lining: grey-green enamel, one bolted lap seam, cart scuffs and chips', use: 'Surface Run cargo-lift cab: walls, ceiling, gate posts, landing doors (tinted)'},
  deck: {id: 'cab-floor-tread', call: 6, sha256: '3c8b37b7acac665cccddd27e77160a4213fe8e5ded27d1a1c1e5ae94acf7dea0', cls: 'tread', u: {periods: 4}, v: {periods: 4}, periodM: 0.12,
    relief: [[1, 5, 0.0004], [2, 14, 0.0011]], rough: [0.28, 0.82], metal: [0.55, 1], ao: [12, 0.3, 0.45],
    subject: 'worn steel diamond tread plate (raised lentil lugs, grime between them)', use: 'Surface Run cargo-lift cab: the deck and the kick plates'},
  hazard: {id: 'hazard-stripe', call: 3, sha256: 'db68ad7e3573ca98f748a6b1061614a97232e1cd64d12d84a5e49f6a1274f8a4', cls: 'hazard', u: {periods: 3}, v: {periods: 3}, periodM: 0.2 * Math.SQRT2,
    relief: [[1, 6, 0.0002]], rough: [0.55, 0.85], metal: null, ao: [6, 0.15, 0.75],
    subject: 'worn yellow / black 45 degree hazard striping on steel (100 mm stripes)', use: 'Surface Run cargo-lift cab: the deck border, the gate sill / header edges'},
  liner: {id: 'shaft-concrete', call: 5, sha256: '27b44cd690c54f02ab736f9447bec019c4bb778bd7d0dd1db647f02bd3c6ab8d', cls: 'concrete', u: 'free', v: 'free', frameM: 2,
    relief: [[1, 5, 0.0004], [4, 24, 0.0012]], rough: [0.82, 0.96], metal: null, ao: [10, 0.25, 0.6],
    subject: 'smooth cast-in-place concrete shaft wall (bug holes, faint stains)', use: 'Surface Run cargo-lift shaft liner seen through the barred gate'},
  bumper: {id: 'bumper-board', call: 2, sha256: '866867963bb6a1fd0525ed4d49f242371a8d15be7ccb43a8ef2a02a1f474388f', cls: 'wood', u: 'free', v: 'free', frameM: 1.2,
    relief: [[1, 4, 0.0002], [2, 12, 0.0005]], rough: [0.5, 0.82], metal: null, ao: [8, 0.2, 0.6],
    subject: 'worn oiled hardwood bumper board, horizontal grain, cart gouges', use: 'Surface Run cargo-lift cab: the bumper rails along the walls'},
};
const LABELS = {id: 'cab-placards', call: 4, sha256: '5ed6128889c0539be001bf9e8f029a30eb3bc00cd3491d19e36904cf64607fc7', subject: 'four cab placards (capacity plate, stand clear of gate, inspection certificate, load evenly)',
  use: 'Surface Run cargo-lift cab: the placards on its walls', order: ['capacity', 'clear', 'certificate', 'load']};

// ---------- the ledger ----------
const rows = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function source(s) {
  const intent = rows.find(r => r.event === 'intent' && r.n === s.call && r.id === s.id);
  const res = rows.find(r => r.event === 'result' && r.n === s.call && r.id === s.id);
  if (!intent || !res || res.status !== 'ok' || res.files?.length !== 1) fail(`${s.id}: ledger call ${s.call} is not one accepted image`);
  const file = res.files[0], raw = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(raw) !== file.sha256) fail(`${s.id}: raw file hash differs from the ledger`);
  if (s.sha256 && s.sha256 !== file.sha256) fail(`${s.id}: raw file hash differs from the pinned source`);
  return {intent, res, file, raw};
}

// ---------- numeric helpers ----------
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 10000) / 10000;
/** Separable box blur (radius r) with wrap-around, w x h float field. */
function boxWrap(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let d = -r; d <= r; d++) s += src[o + ((d % w) + w) % w];
    for (let x = 0; x < w; x++) { tmp[o + x] = s / k; s += src[o + (x + r + 1) % w] - src[o + ((x - r) % w + w) % w]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[(((d % h) + h) % h) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / k; s += tmp[((y + r + 1) % h) * w + x] - tmp[(((y - r) % h + h) % h) * w + x]; }
  }
  return out;
}
const blurWrap = (src, w, h, r) => (r < 1 ? Float32Array.from(src) : boxWrap(boxWrap(boxWrap(src, w, h, r), w, h, r), w, h, r));
const cosW = t => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t))); // 0 -> 1

/**
 * The period (px, sub-pixel) of luminance along an axis: autocorrelation of the high-passed field over pure shifts, the strongest peak
 * in [lo, hi] (clamped borders: only the overlapping region is compared).
 */
function measurePeriod(L, W, H, axis, lo, hi) {
  const hp = Float32Array.from(L);
  const bl = blurWrap(L, W, H, 24);
  for (let i = 0; i < hp.length; i++) hp[i] -= bl[i];
  const step = 2, corr = new Float64Array(hi + 2);
  for (let d = lo - 1; d <= hi + 1; d++) {
    let s = 0, a = 0, b = 0;
    for (let y = 0; y < H - (axis === 'v' ? d : 0); y += step) for (let x = 0; x < W - (axis === 'u' ? d : 0); x += step) {
      const p = hp[y * W + x], q = hp[(y + (axis === 'v' ? d : 0)) * W + x + (axis === 'u' ? d : 0)];
      s += p * q; a += p * p; b += q * q;
    }
    corr[d] = s / Math.sqrt(a * b || 1);
  }
  let best = lo;
  for (let d = lo; d <= hi; d++) if (corr[d] > corr[best]) best = d;
  const y0 = corr[best - 1], y1 = corr[best], y2 = corr[best + 1], den = y0 - 2 * y1 + y2;
  return {period: best + (den < 0 ? 0.5 * (y0 - y2) / den : 0), score: r3(corr[best])};
}

/** Mean absolute grey difference across the wrap seams vs the interior neighbours (tile check). */
function seamCheck(grey, W, H) {
  let seamLR = 0, seamTB = 0, innerLR = 0, innerTB = 0, n = 0;
  for (let y = 0; y < H; y++) seamLR += Math.abs(grey[y * W] - grey[y * W + W - 1]) / H;
  for (let x = 0; x < W; x++) seamTB += Math.abs(grey[x] - grey[(H - 1) * W + x]) / W;
  for (let y = 1; y < H; y += 4) for (let x = 1; x < W; x += 4) { innerLR += Math.abs(grey[y * W + x] - grey[y * W + x - 1]); innerTB += Math.abs(grey[y * W + x] - grey[(y - 1) * W + x]); n++; }
  innerLR /= n; innerTB /= n;
  return {seamLR: r3(seamLR), seamTB: r3(seamTB), interiorLR: r3(innerLR), interiorTB: r3(innerTB), ratioLR: r3(seamLR / innerLR), ratioTB: r3(seamTB / innerTB)};
}

const decode = async buf => (await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true})).data;

async function processSet(key, s) {
  const {intent, res, file, raw} = source(s);
  const img = await sharp(raw).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const W = img.info.width, H = img.info.height, rgb = img.data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = lumOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  // --- a. crop per axis ---
  const axis = (a) => {
    const size0 = a === 'u' ? W : H, room = size0 - 2 * FEATHER, spec = s[a];
    if (spec === 'free') return {mode: 'free', start: FEATHER, size: room, periods: 1, periodPx: room, mPerPx: s.frameM / size0, why: `free axis: the frame inside a ${FEATHER} px feather margin`};
    const guess = size0 / spec.periods, m = measurePeriod(L, W, H, a, Math.round(guess * 0.6), Math.round(guess * 1.5));
    const k = Math.max(1, Math.floor(room / m.period)), size = Math.round(k * m.period), start = Math.round((size0 - size) / 2);
    return {mode: 'periodic', start, size, periods: k, periodPx: m.period, score: m.score, mPerPx: s.periodM / m.period, why: `${k} whole measured periods of ${r3(m.period)} px (autocorrelation ${m.score}; ${spec.periods} asked)`};
  };
  const ax = {u: axis('u'), v: axis('v')};
  const cw = ax.u.size, ch = ax.v.size, x0 = ax.u.start, y0 = ax.v.start;
  // --- b. seam: cosine cross-fade of the last FEATHER columns / rows into the source's own continuation ---
  const crop = new Float32Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let c = 0; c < 3; c++) crop[(y * cw + x) * 3 + c] = rgb[((y0 + y) * W + x0 + x) * 3 + c];
  for (let y = 0; y < ch; y++) for (let i = 0; i < FEATHER; i++) {
    const x = cw - FEATHER + i, t = cosW((i + 1) / (FEATHER + 1)), sx = x0 + x - cw; // (sx = x0 - FEATHER + i: the true neighbours of column 0)
    for (let c = 0; c < 3; c++) crop[(y * cw + x) * 3 + c] = (1 - t) * crop[(y * cw + x) * 3 + c] + t * rgb[((y0 + y) * W + sx) * 3 + c];
  }
  const rowSrc = (yy, x) => { // the seam-blended row of the source at y = yy (the same u blend as the crop)
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) out[c] = rgb[(yy * W + x0 + x) * 3 + c];
    if (x >= cw - FEATHER) { const i = x - (cw - FEATHER), t = cosW((i + 1) / (FEATHER + 1)); for (let c = 0; c < 3; c++) out[c] = (1 - t) * out[c] + t * rgb[(yy * W + x0 + x - cw) * 3 + c]; }
    return out;
  };
  for (let i = 0; i < FEATHER; i++) {
    const y = ch - FEATHER + i, t = cosW((i + 1) / (FEATHER + 1)), sy = y0 + y - ch;
    for (let x = 0; x < cw; x++) { const n = rowSrc(sy, x); for (let c = 0; c < 3; c++) crop[(y * cw + x) * 3 + c] = (1 - t) * crop[(y * cw + x) * 3 + c] + t * n[c]; }
  }
  const cropBuf = Buffer.alloc(cw * ch * 3);
  for (let i = 0; i < crop.length; i++) cropBuf[i] = Math.round(Math.min(255, Math.max(0, crop[i])));
  // --- c. resize the 3 x 3 wrap tiling, centre extract ---
  const tiled = Buffer.alloc(cw * 3 * ch * 3 * 3);
  for (let ty = 0; ty < 3; ty++) for (let y = 0; y < ch; y++) for (let tx = 0; tx < 3; tx++) cropBuf.copy(tiled, (((ty * ch + y) * cw * 3) + tx * cw) * 3, y * cw * 3, (y + 1) * cw * 3);
  const big = await sharp(tiled, {raw: {width: cw * 3, height: ch * 3, channels: 3}}).resize(N * 3, N * 3, {kernel: 'lanczos3', fit: 'fill'}).raw().toBuffer();
  const col = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) big.copy(col, y * N * 3, ((N + y) * N * 3 + N) * 3, ((N + y) * N * 3 + 2 * N) * 3);
  const colorJpg = await sharp(col, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: Q.color, mozjpeg: true}).toBuffer();
  const colDec = await decode(colorJpg);
  const NN = N * N, grey = new Float32Array(NN), Lc = new Float32Array(NN);
  for (let i = 0; i < NN; i++) { grey[i] = lumOf(colDec[i * 3], colDec[i * 3 + 1], colDec[i * 3 + 2]); Lc[i] = grey[i] / 255; }
  const plainGrey = new Float32Array(NN);
  {
    const plain = await sharp(cropBuf, {raw: {width: cw, height: ch, channels: 3}}).resize(N, N, {kernel: 'lanczos3', fit: 'fill'}).raw().toBuffer();
    for (let i = 0; i < NN; i++) plainGrey[i] = lumOf(plain[i * 3], plain[i * 3 + 1], plain[i * 3 + 2]);
  }
  const tileAfter = seamCheck(grey, N, N);
  // --- d. height (m) -> normal, ORM ---
  const spanU = r4(cw * ax.u.mPerPx), spanV = r4(ch * ax.v.mPerPx);
  const tU = spanU / N, tV = spanV / N;
  const Hm = new Float32Array(NN);
  for (const [rb, rbase, amp] of s.relief) {
    const a = blurWrap(Lc, N, N, rb), b = blurWrap(Lc, N, N, rbase);
    let sd = 0; for (let i = 0; i < NN; i++) sd += (a[i] - b[i]) ** 2; sd = Math.sqrt(sd / NN) || 1;
    for (let i = 0; i < NN; i++) Hm[i] += amp * Math.max(-3, Math.min(3, (a[i] - b[i]) / sd));
  }
  const Hs = blurWrap(Hm, N, N, 1), cavity = blurWrap(Hm, N, N, s.ao[0]);
  const Lb3 = blurWrap(Lc, N, N, 3), Lb12 = blurWrap(Lc, N, N, 12);
  let tSd = 0; for (let i = 0; i < NN; i++) tSd += (Lb12[i] - Lb3[i]) ** 2; tSd = Math.sqrt(tSd / NN) || 1;
  let hSd = 0; for (let i = 0; i < NN; i++) hSd += Hm[i] ** 2; hSd = Math.sqrt(hSd / NN) || 1;
  const nrm = Buffer.alloc(NN * 3), orm = Buffer.alloc(NN * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dx = (Hs[y * N + (x + 1) % N] - Hs[y * N + (x - 1 + N) % N]) / (2 * tU), dy = (Hs[((y + 1) % N) * N + x] - Hs[((y - 1 + N) % N) * N + x]) / (2 * tV);
    const l = Math.hypot(dx, dy, 1);
    nrm[i * 3] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[i * 3 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nrm[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    const ao = Math.min(1, Math.max(s.ao[2], 1 - s.ao[1] * Math.max(0, (cavity[i] - Hm[i]) / hSd)));
    const t = Math.min(1, Math.max(0, 0.5 + 0.5 * (Lb12[i] - Lb3[i]) / tSd)); // darker than its surroundings -> rougher
    const rough = s.rough[0] + (s.rough[1] - s.rough[0]) * t;
    const metal = s.metal ? s.metal[1] - (s.metal[1] - s.metal[0]) * t : 0;
    orm[i * 3] = Math.round(ao * 255); orm[i * 3 + 1] = Math.round(Math.min(1, rough) * 255); orm[i * 3 + 2] = Math.round(metal * 255);
  }
  const normalJpg = await sharp(nrm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: Q.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const ormJpg = await sharp(orm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: Q.orm, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  if (DEBUG_DIR) { fs.mkdirSync(DEBUG_DIR, {recursive: true}); for (const [m, b] of [['color', colorJpg], ['normal', normalJpg], ['orm', ormJpg]]) fs.writeFileSync(path.join(DEBUG_DIR, `${key}-${m}.jpg`), b); }
  // --- e. means ---
  const mean = [0, 0, 0];
  for (let i = 0; i < NN; i++) for (let k = 0; k < 3; k++) mean[k] += s2l(colDec[i * 3 + k]) / NN;
  const ormDec = await decode(ormJpg);
  let rough = 0, metal = 0; for (let i = 0; i < NN; i++) { rough += ormDec[i * 3 + 1] / 255 / NN; metal += ormDec[i * 3 + 2] / 255 / NN; }
  const name = s.id.replace(/^cab-/, ''), base = `${OUT_DIR_REL}/lift-cab-${name}`;
  const out = {color: {url: `${base}-color.jpg`, buf: colorJpg}, normal: {url: `${base}-normal.jpg`, buf: normalJpg}, orm: {url: `${base}-orm.jpg`, buf: ormJpg}};
  const axisRec = a => ({mode: ax[a].mode, cropStart: ax[a].start, cropSize: ax[a].size, periods: ax[a].periods, periodPx: r3(ax[a].periodPx), mmPerPx: r4(ax[a].mPerPx * 1000),
    ...(ax[a].score !== undefined ? {autocorrelation: ax[a].score} : {}), why: ax[a].why});
  const prov = provenance(`lift-cab-${name}`, s, {intent, res, file, raw, W, H}, {
    crop: {x: x0, y: y0, w: cw, h: ch, u: axisRec('u'), v: axisRec('v')},
    seam: {featherPx: FEATHER, method: 'the last featherPx columns / rows cross-fade (cosine) into the source pixels just before the crop start (the true wrap neighbours; a whole number of periods earlier on a periodic axis)'},
    lighting: 'none (the sources are evenly lit material scans)',
    resize: {width: N, height: N, kernel: 'lanczos3', fit: 'fill', wrap: '3 x 3 tiled, centre extract'},
    height: {bands: s.relief.map(([a, b, m]) => ({blurPx: a, basePx: b, metresPerSd: m})), note: 'luminance band-passes (output texels), clamped at 3 standard deviations'},
    normal: {convention: 'tangent space, R = -dh/dx, G = +dh/dy (image y down), B = z (build-reactor-kit.mjs)', slopes: 'metres per metre from the height (m) and the span per texel'},
    orm: {r: `ambient occlusion from cavity (blur ${s.ao[0]} px, ${s.ao[1]} per height sd, floor ${s.ao[2]})`, g: `roughness ${s.rough[0]}-${s.rough[1]} (darker than the 12 px surroundings = rougher)`,
      b: s.metal ? `metalness ${s.metal[1]} bare steel -> ${s.metal[0]} where darker (grime)` : 'metalness 0'},
    encode: {color: {quality: Q.color, mozjpeg: true, chromaSubsampling: '4:2:0'}, normal: {quality: Q.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}, orm: {quality: Q.orm, mozjpeg: true, chromaSubsampling: '4:4:4'}, metadata: 'stripped'},
  }, {tileCheck: {plainCrop: seamCheck(plainGrey, N, N), after: tileAfter, note: 'mean absolute grey difference (0..255) across the wrap seams vs interior neighbours along the same axis (1024 buffers); plainCrop = the crop without the feather'},
    spanM: {u: spanU, v: spanV}, meanLinearAlbedo: mean.map(r4), meanRoughness: r3(rough), meanMetalness: r3(metal)}, out);
  return {key, s, out, provRel: `${PROV_DIR_REL}/lift-cab-${name}.json`, provBuf: prov, span: [spanU, spanV], mean: mean.map(r4), rough: r3(rough), metal: r3(metal), ax, tileAfter};
}

/** The placard sheet: colour atlas (1024 x 1024, clamped) + the four labels' rectangles measured against the flat background. */
async function processLabels(s) {
  const {intent, res, file, raw} = source(s);
  const img = await sharp(raw).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const W = img.info.width, H = img.info.height, rgb = img.data;
  // background: the median colour of a 12 px border ring
  const ring = [[], [], []];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 12 || y < 12 || x >= W - 12 || y >= H - 12) for (let c = 0; c < 3; c++) ring[c].push(rgb[(y * W + x) * 3 + c]);
  const bg = ring.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
  const rects = [];
  for (let q = 0; q < 4; q++) {
    const qx0 = (q % 2) * (W >> 1), qy0 = (q >> 1) * (H >> 1), qw = W >> 1, qh = H >> 1;
    const colHit = new Float64Array(qw), rowHit = new Float64Array(qh);
    for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) {
      const i = ((qy0 + y) * W + qx0 + x) * 3, d = Math.abs(rgb[i] - bg[0]) + Math.abs(rgb[i + 1] - bg[1]) + Math.abs(rgb[i + 2] - bg[2]);
      if (d > 36) { colHit[x]++; rowHit[y]++; }
    }
    const span = (h, len, other) => { let a = 0, b = len - 1; while (a < len && h[a] < other * 0.25) a++; while (b > 0 && h[b] < other * 0.25) b--; return [a, b]; };
    const [cx0, cx1] = span(colHit, qw, qh * 0.5), [cy0, cy1] = span(rowHit, qh, qw * 0.5);
    if (cx1 - cx0 < qw * 0.4 || cy1 - cy0 < qh * 0.2) fail(`${s.id}: label ${q} not found on the sheet`);
    rects.push({x0: qx0 + cx0, y0: qy0 + cy0, x1: qx0 + cx1 + 1, y1: qy0 + cy1 + 1});
  }
  const colorJpg = await sharp(raw).removeAlpha().resize(N, N, {kernel: 'lanczos3', fit: 'fill'}).jpeg({quality: Q.color, mozjpeg: true}).toBuffer();
  // UV rects (three flips textures: v = 1 - y), inset 2 source px (no background at the edges)
  const uv = rects.map(r => [r4((r.x0 + 2) / W), r4(1 - (r.y1 - 2) / H), r4((r.x1 - 2) / W), r4(1 - (r.y0 + 2) / H)]);
  const aspect = rects.map(r => r3((r.x1 - r.x0) / (r.y1 - r.y0)));
  const url = `${OUT_DIR_REL}/lift-cab-placards-color.jpg`;
  const out = {color: {url, buf: colorJpg}};
  const prov = provenance('lift-cab-placards', s, {intent, res, file, raw, W, H}, {
    background: bg, labels: Object.fromEntries(s.order.map((k, i) => [k, {rectPx: rects[i], uv: uv[i], aspect: aspect[i]}])),
    method: 'per quarter: the columns / rows where at least a quarter of the pixels differ from the border-ring median colour by > 36 (sum of |dRGB|)',
    resize: {width: N, height: N, kernel: 'lanczos3', fit: 'fill'}, encode: {color: {quality: Q.color, mozjpeg: true, chromaSubsampling: '4:2:0'}, metadata: 'stripped'},
  }, {}, out);
  return {key: 'placards', s, out, provRel: `${PROV_DIR_REL}/lift-cab-placards.json`, provBuf: prov, uv, aspect};
}

function provenance(asset, s, src, recipe, extra, out) {
  const {intent, res, file, raw, W, H} = src;
  const prov = {schema: 'last-line-derivative/1', asset, task: TASK,
    status: "runtime derivative (crop / seam feather / resize / derived normal + ORM / JPEG; deterministic processing only) of an ORIGINAL texture source generated for this project with Codex native image_gen (owned Codex CLI) under the user's authorization for the Surface Run cargo-lift cab retexture; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
    use: s.use, subject: s.subject, ...(s.cls ? {cls: s.cls} : {}),
    rebuild: 'node tools/asset-pipeline/props/build-lift-cab-textures.mjs',
    rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-<id>-exec-<uuid>.png, prompts/frozen/<id>-c<n>.txt} (private, outside Git)`,
    generator: GENERATOR,
    codex: {generator: GENERATOR, ledgerCall: s.call, session: res.session, requested: intent.t, finished: res.t, seconds: res.seconds, imageGenGenerations: res.imageGenGenerations ?? null},
    prompt: {file: intent.promptFile, sha256: intent.promptSha256},
    source: {file: path.basename(file.raw), sha256: file.sha256, bytes: raw.length, width: W, height: H},
    recipe: {...recipe, tool: 'sharp (libvips) + plain JS via tools/asset-pipeline/props/build-lift-cab-textures.mjs'},
    ...extra,
    outputs: Object.fromEntries(Object.entries(out).map(([k, o]) => [k, {url: o.url, bytes: o.buf.length, sha256: sha(o.buf), width: N, height: N, format: 'jpeg'}]))};
  const buf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  const hit = buf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
  if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
  return buf;
}

// ---------- build ----------
const sets = [];
for (const [key, s] of Object.entries(SOURCES)) sets.push(await processSet(key, s));
const labels = await processLabels(LABELS);

const outputs = [];
for (const t of [...sets, labels]) { for (const o of Object.values(t.out)) outputs.push({path: o.url, buf: o.buf}); outputs.push({path: t.provRel, buf: t.provBuf}); }

const tsText = [
  `// GENERATED by tools/asset-pipeline/props/build-lift-cab-textures.mjs — do not edit (task ${TASK}).`,
  "// The Surface Run cargo-lift cab's ORIGINAL Codex-generated surface sets (Codex native image_gen colour sources; whole-period crop / seam",
  '// feather / resize; normal + ORM derived locally) and its placard sheet. Provenance assets/derivatives/lift-cab-<name>.json. Per set:',
  '// colour (sRGB), normal (tangent space, +Y up) and ORM (R ao, G roughness, B metalness) JPEGs; span = metres one repeat covers (u, v);',
  "// mean = the colour map's LINEAR mean albedo; rough / metal = the ORM's means. Shared files (no level owns them: the car rides between",
  '// levels). Placards: one colour atlas, each label a UV rect [u0, v0, u1, v1] (three flipY) and its width / height.',
  "export type LiftCabClass = 'paint' | 'tread' | 'hazard' | 'concrete' | 'wood';",
  'export interface LiftCabFile { readonly url: string; readonly bytes: number }',
  'export interface LiftCabSet {',
  '  readonly color: LiftCabFile; readonly normal: LiftCabFile; readonly orm: LiftCabFile;',
  '  readonly span: readonly [number, number]; readonly mean: readonly [number, number, number]; readonly rough: number; readonly metal: number; readonly cls: LiftCabClass;',
  '}',
  'export const LIFT_CAB_TEXTURES = {',
  ...sets.map(t => `  ${t.key}: {color: {url: '${t.out.color.url}', bytes: ${t.out.color.buf.length}}, normal: {url: '${t.out.normal.url}', bytes: ${t.out.normal.buf.length}}, orm: {url: '${t.out.orm.url}', bytes: ${t.out.orm.buf.length}},\n    span: [${t.span[0]}, ${t.span[1]}], mean: [${t.mean.join(', ')}], rough: ${t.rough}, metal: ${t.metal}, cls: '${t.s.cls}'},`),
  '} as const satisfies Readonly<Record<string, LiftCabSet>>;',
  'export type LiftCabTexKey = keyof typeof LIFT_CAB_TEXTURES;',
  `export const LIFT_CAB_PLACARDS = {color: {url: '${labels.out.color.url}', bytes: ${labels.out.color.buf.length}}, labels: {`,
  ...LABELS.order.map((k, i) => `  ${k}: {uv: [${labels.uv[i].join(', ')}], aspect: ${labels.aspect[i]}},`),
  '}} as const;',
  'export type LiftCabPlacard = keyof typeof LIFT_CAB_PLACARDS.labels;',
  '',
].join('\n');

const credPath = path.join(PUB, CREDITS_REL);
const credSrc = fs.readFileSync(credPath, 'utf8');
const all = [...sets.map(t => t.s), LABELS];
const firstCalls = all.every(s => rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.id === s.id && r.n < s.call).length === 0);
const credSection = [CREDITS_BEGIN, '## Surface Run cargo-lift cab: surface sets (painted steel, tread plate, hazard striping, shaft concrete, bumper boards) and placards', '',
  `Original textures generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool), one ledgered call per texture (${all.length} accepted calls${firstCalls ? ', each accepted at its first call' : ''}), under the user's authorization for the Surface Run cargo-lift cab retexture (task ${TASK}). Runtime derivatives by \`tools/asset-pipeline/props/build-lift-cab-textures.mjs\` (deterministic processing only: a crop to whole measured pattern periods, a seam feather from the source's own pixels, resize, and normal / ORM maps derived locally from the colour source; provenance: \`assets/derivatives/lift-cab-<name>.json\`). The placard wording is fictional signage. Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters, prompts and the generation ledger are kept outside Git.`, '',
  ...sets.map(t => `- \`${OUT_DIR_REL}/lift-cab-${t.s.id.replace(/^cab-/, '')}-{color,normal,orm}.jpg\` — ${t.s.subject} (Codex call ${t.s.call})`),
  `- \`${OUT_DIR_REL}/lift-cab-placards-color.jpg\` — ${LABELS.subject} (Codex call ${LABELS.call})`, CREDITS_END].join('\n');
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
const credText = credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`;
outputs.push({path: CREDITS_REL, buf: Buffer.from(credText)});

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path) && !(f.path.startsWith(`${OUT_DIR_REL}/lift-cab-`) || f.path.startsWith(`${PROV_DIR_REL}/lift-cab-`))),
  ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

console.log(JSON.stringify({task: TASK, sets: sets.map(t => ({key: t.key, call: t.s.call, crop: `${t.ax.u.start},${t.ax.v.start} ${t.ax.u.size}x${t.ax.v.size}`, why: [t.ax.u.why, t.ax.v.why],
  span: t.span, mean: t.mean, rough: t.rough, metal: t.metal, seam: `LR ${t.tileAfter.ratioLR}, TB ${t.tileAfter.ratioTB}`, bytes: Object.values(t.out).map(o => o.buf.length)})),
  placards: {uv: labels.uv, aspect: labels.aspect, bytes: labels.out.color.buf.length},
  textureBytes: outputs.filter(o => o.path.endsWith('.jpg')).reduce((n, o) => n + o.buf.length, 0)}, null, 1));

if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === tsText ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-lift-cab-textures: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), tsText);
fs.writeFileSync(ALLOW, allowText);
console.log('build-lift-cab-textures: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
