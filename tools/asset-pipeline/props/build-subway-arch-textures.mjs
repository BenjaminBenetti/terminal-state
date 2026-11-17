// Task studio-subway-architecture-materials-rework-20261117-072826-01 (lane TEX): runtime PBR sets of the Subway architecture rework's
// Codex-generated ORIGINAL tileable surface textures — glazed wall tile fields and accent bands, stone / granite / limestone cladding,
// precast concrete, enamel panels, a metal slat ceiling, terrazzo and granite floors, a plaster soffit and painted shotcrete rock.
// Root CLAUDE.md "Textures — Codex for INITIAL sources": every colour source is ONE ledgered Codex native image_gen call (the lead's
// helper); nothing here draws. Processing only, deterministic, recorded per set in its provenance 'recipe':
//   a. PERIOD CROP: the joint lines (grout / joints / gaps / brass strips) are found on the source's own pixels (row / column profiles,
//      high-passed by a moving median, the set's joint polarity); the crop holds a WHOLE number of measured joint periods (running bond:
//      2 courses vertically, 1 tile length horizontally, so the half offset survives the wrap). Multi-joint axes start and end ON a joint
//      centre (the wrap seam lies inside the uniform grout); an axis with a single joint per frame is cropped to one period centred on
//      it (its period inferred from the other axis' measured scale or the prompt's frame); jointless axes keep the full frame.
//   b. SEAM: a cropped axis is feathered across the wrap with the source's OWN continuation (the pixels just before the crop start —
//      the true neighbours of the first column / row); a full-frame axis whose wrap seam measures clearly worse than its interior is
//      patched with a feathered band taken from a joint-free interior strip (the offset-and-cross-blend recipe, placed off the joints).
//   c. LIGHTING: the low-frequency luminance field is measured (3 x 3 cell medians: corner-to-centre); a set whose field exceeds the
//      threshold would be divided by its wrap-blurred field (none did at build time — every value is in its provenance).
//   d. resize to 1024 x 1024 (sharp lanczos3, fill) of the 3 x 3 wrap-tiled crop (centre extract: exact wrap filtering).
//   e. HEIGHT (metres, per material class: grout / gap / shadow-gap valleys from the joints found again on the final map, bevels,
//      cavity detail from luminance, painted rock = multi-scale luminance relief) -> NORMAL (the Reactor kit's channel convention:
//      R = -dh/dx, G = +dh/dy with y down, B = z; tangent-space, +Y up) and ORM (R = AO from cavity, G = roughness in the class
//      range, B = metalness: 0 except terrazzo's brass strips).
//   f. the final colour map's LINEAR mean albedo and the ORM's mean roughness go into the generated registry.
//
// Reads (never modifies) the private task folder kept OUTSIDE Git (reference/tasks/subway-architecture-materials-rework-20261117-072826/gen/):
//   LEDGER.jsonl (intent + result rows of every Codex call), raw/codex-<n>-<id>-exec-<uuid>.png, prompts/frozen/<id>-c<n>.txt
// and writes deterministically:
//   game/public/assets/textures/subway/arch/subway-arch-<name>-{color,normal,orm}.jpg   1024 x 1024 JPEG (mozjpeg q85 / q90 / q88)
//   game/public/assets/derivatives/subway-arch-<name>.json                              provenance (no prompt text / URLs / local paths)
//   game/src/assets/subwayArchTextures.generated.ts                                     urls / bytes / span / mean albedo / roughness
//   game/public/assets/CREDITS.md                                                       the marked subway-arch-20261117 section
//   tools/release/public-inputs.json                                                    ONLY this script's paths (+ CREDITS.md)
//
// Usage: node tools/asset-pipeline/props/build-subway-arch-textures.mjs [--dry-run [--only=key,key] | --check] [--task-dir=<private task folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-subway-architecture-materials-rework-20261117-072826-01';
const TASK_REL = 'reference/tasks/subway-architecture-materials-rework-20261117-072826';
const PUB = path.join(root, 'game/public');
const OUT_DIR_REL = 'assets/textures/subway/arch';
const PROV_DIR_REL = 'assets/derivatives';
const TS_REL = 'game/src/assets/subwayArchTextures.generated.ts';
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS_BEGIN = '<!-- BEGIN subway-arch-20261117 (build-subway-arch-textures.mjs) -->';
const CREDITS_END = '<!-- END subway-arch-20261117 -->';
const N = 1024;
const Q = {color: 85, normal: 90, orm: 88};
const GENERATOR = 'Codex native image_gen (owned Codex CLI)';

const DRY = process.argv.includes('--dry-run');
/** QA only: writes <key>-joints.png (the final colour with the detected joint lines in magenta) there (never inside the repo). */
const DEBUG_DIR = process.argv.find(a => a.startsWith('--debug-dir='))?.slice('--debug-dir='.length) ?? null;
const CHECK = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-subway-arch-textures: ${m}`); process.exit(1); };

function taskDir() {
  const arg = process.argv.find(a => a.startsWith('--task-dir='));
  if (arg) return path.resolve(arg.slice('--task-dir='.length));
  for (let d = root, i = 0; i < 6; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, TASK_REL, 'gen/LEDGER.jsonl'))) return path.join(d, TASK_REL);
  return fail(`missing ${TASK_REL}/gen (raw Codex outputs live outside Git; pass --task-dir=)`);
}
const GEN = path.join(taskDir(), 'gen');

// ---------- the accepted Codex sources (one ledgered call each; the latest ok call per id at build time) ----------
// axis: {mode: 'joints' (>= 2 joint lines measured: `steps` lines per period, `module` metres per period) | 'single' (one joint per
// frame: period = `module`, inferred from the other axis' measured scale or `frame`) | 'none' (jointless: full frame)}.
// u = image x (horizontal), v = image y (vertical). grout: the joint lines' polarity in luminance ('dark' / 'light'; 'brass' = hue).
// frame = metres the prompt's frame covers horizontally (used only where no axis measures the scale).
const RUN = (lenM, courseM) => ({u: {mode: 'joints', steps: 2, module: lenM}, v: {mode: 'joints', steps: 2, module: 2 * courseM}});
const STACK = (wM, hM) => ({u: {mode: 'joints', steps: 1, module: wM}, v: {mode: 'joints', steps: 1, module: hM}});
const SOURCES = {
  tileCream: {id: 'tile-cream', call: 10, sha256: '321523beb0e35b607f3b33fc1cd4640f1133290980c477d277c49b8b8ec92f78', cls: 'tile', grout: 'dark', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'cream glazed 150 x 75 mm bevelled subway tile, running bond', use: 'Subway public walls: heritage cream tile field'},
  tileBlueSquare: {id: 'tile-blue-square', call: 9, sha256: 'b17e8ccac2072d30df320e41ae2da7cd18b6125ddba6379964bda223ccd9e255', cls: 'tile', grout: 'dark', ...STACK(0.15, 0.15), frame: 1.2,
    subject: 'pale grey-blue glazed 150 x 150 mm square tile, stack bond', use: 'Subway public walls: mid-century civic tile field'},
  tileGreenBrick: {id: 'tile-green-brick', call: 11, sha256: 'a3fd13d718c55f50a1d11f5ab4a7846c1bb5e417f5f9ea2fe8512800af12988a', cls: 'tile', grout: 'light', ...RUN(0.2, 0.075), frame: 1.2,
    subject: 'sage green glazed 200 x 75 mm brick slips, running bond', use: 'Subway public walls: glazed brick tile field'},
  tileTerracotta: {id: 'tile-terracotta', call: 12, sha256: 'efcabf13992aee240e642ef5236453f250060615dfeb3b9ad4a48de745128dad', cls: 'tile', grout: 'dark', ...RUN(0.2, 0.1), frame: 1.2,
    subject: 'honey-amber glazed terracotta faience 200 x 100 mm, running bond', use: 'Subway public walls: faience tile field'},
  tileWhiteLarge: {id: 'tile-white-large', call: 13, sha256: 'e46edd0ae998b90a5469afaa90f6ba0e3a72ecd231f602c28783ddd65bdad5b6', cls: 'tile', grout: 'dark', ...STACK(0.3, 0.15), frame: 1.2,
    subject: 'white gloss 300 x 150 mm large-format tile, stack bond', use: 'Subway public walls: modern white tile field'},
  bandOxblood: {id: 'band-oxblood', call: 17, sha256: '1fe2c41060fce705adf04434cab8f2e467e984cd3eee7b26cae3c7bf08160bc0', cls: 'tile', grout: 'light', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'oxblood glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  bandNavy: {id: 'band-navy', call: 16, sha256: '1fefd6a9cdc394871221e257803f33859eddfe93b68d4cfa38410bede1d57864', cls: 'tile', grout: 'light', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'navy glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  bandBottle: {id: 'band-bottle', call: 15, sha256: '38f99db4cf8f345ee22a834259f90c5af391e1e841b6b5b8fc6dc02ab937e8af', cls: 'tile', grout: 'light', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'bottle green glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  bandOchre: {id: 'band-ochre', call: 14, sha256: 'bc542c3e0e7dccc096002dc79b3a92c318e83d5b0b7cc8037d73357e0a1ac3d5', cls: 'tile', grout: 'dark', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'ochre glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  bandSignal: {id: 'band-signal', call: 18, sha256: 'a503354278b9e100bd6e7e171705d0bcfd223f8b6391399e2a9a579fff8174c4', cls: 'tile', grout: 'light', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'signal red glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  bandOrange: {id: 'band-orange', call: 19, sha256: '48d7812dd672fc9f408ecc1318a1887dbe498a178d423669b7434c470695e0a1', cls: 'tile', grout: 'light', ...RUN(0.15, 0.075), frame: 1.2,
    subject: 'orange glazed 150 x 75 mm accent tile, running bond', use: 'Subway wall accent bands / friezes'},
  plinthGranite: {id: 'plinth-granite', call: 7, sha256: 'a920ff4b0ed7df5607893a51188089a426de8ec49e8d2d25fd5f772c0c9c81b8', cls: 'stone', grout: 'dark', u: {mode: 'single', module: 0.6}, v: {mode: 'joints', steps: 1, module: 0.3}, frame: 1.2,
    subject: 'dark honed granite 600 x 300 mm cladding panels, stack bond', use: 'Subway wall plinths / skirting'},
  stoneLimestone: {id: 'stone-limestone', call: 20, sha256: '595266249793470d82ea5b1bac9bfd3dc8e2f78a8f6e8cca97430f437407ebc6', cls: 'stone', grout: 'dark', u: {mode: 'single', module: 1.2}, v: {mode: 'single', module: 0.6}, frame: 1.2, patchAt: 0.25, patchBand: 128,
    subject: 'honed pale limestone 1200 x 600 mm cladding panels', use: 'Subway grand halls: limestone wall cladding'},
  concretePrecast: {id: 'concrete-precast', call: 4, sha256: 'ffa5d689fb6ef58661c791928034b604f94a5200a1da134a2bc76b384072be41', cls: 'concrete', grout: 'dark', u: {mode: 'single', module: 1.2}, v: {mode: 'single', module: 1.2}, frame: 2.4, singleCrop: 'centred',
    subject: 'fair-faced precast concrete 1.2 x 1.2 m panels with tie holes', use: 'Subway brutalist halls: precast wall panels'},
  enamelPanel: {id: 'enamel-panel', call: 1, sha256: '8d721ec70094f9bf9037a996180ddacad0b4e1c7519f6f7fb7079ebcaffaf18a', cls: 'enamel', grout: 'dark', u: {mode: 'single', module: 1.2}, v: {mode: 'joints', steps: 1, module: 0.6}, frame: 2.4,
    subject: 'warm white vitreous enamel 1200 x 600 mm panels with shadow-gap joints', use: 'Subway modern stations: enamel wall cladding'},
  metalSlatCeiling: {id: 'metal-slat-ceiling', call: 6, sha256: 'e4dc8ab82cb4d88d205aa6a0e1c3cf2f702f62bcf063da55ff04a9efb10c8637', cls: 'metal', grout: 'dark', u: {mode: 'joints', steps: 1, module: 0.115}, v: {mode: 'none'}, frame: 1.15, hp: 81,
    subject: 'powder-coated 100 mm metal slats with 15 mm dark gaps', use: 'Subway modern stations: linear slat ceiling'},
  floorTerrazzo: {id: 'floor-terrazzo', call: 5, sha256: '53e3c209427b7dd19da961b63411ea7d43a8bd3a75c2ac4d3873832fb4fe201e', cls: 'terrazzo', grout: 'brass', u: {mode: 'single', module: 0.6}, v: {mode: 'single', module: 0.6}, frame: 0.6, patchAt: 0.25,
    subject: 'polished grey terrazzo 600 x 600 mm with brass divider strips', use: 'Subway public floors: terrazzo'},
  floorGranite: {id: 'floor-granite', call: 2, sha256: 'b30114c252200f4e893e69f1b3e4932d222172c3219e881e3535d277b3e05cda', cls: 'stone', grout: 'dark', u: {mode: 'single', module: 0.6}, v: {mode: 'single', module: 0.6}, frame: 1.2,
    subject: 'honed light grey granite 600 x 600 mm floor slabs', use: 'Subway public floors: granite'},
  ceilingPlaster: {id: 'ceiling-plaster', call: 3, sha256: 'c1954d96e4a8ec3c14ddf92c8fb6fddcdf650da1a16e703370f9079ca12f6f33', cls: 'plaster', grout: 'dark', u: {mode: 'none'}, v: {mode: 'none'}, frame: 2.0,
    subject: 'painted cement-render ceiling soffit, off-white', use: 'Subway ceilings: painted render soffit'},
  rockPainted: {id: 'rock-painted', call: 8, sha256: 'c0699cbefee15154c50de7e873d8faaf7b069b8a2c3134c625eaadaa95881501', cls: 'rock', grout: 'dark', u: {mode: 'none'}, v: {mode: 'none'}, frame: 3.0,
    subject: 'off-white painted shotcrete over blasted rock (tinted at runtime)', use: 'Subway cavern stations: painted rock walls / vaults'},
};

/**
 * Per-class relief / finish (metres; roughness ranges). joint = valley depth at the grout / gap, bevel = the shoulder width (m) of a
 * rounded tile / slat edge, detail = luminance-cavity relief as a SLOPE per standard deviation (height = detail x texel size x the
 * normalised fine luminance detail), rough = [face lo, face hi], jointRough = in the joint,
 * ao = [cavity gain per metre, blur radius px, face floor].
 */
const CLASS = {
  tile: {joint: 0.002, bevel: 0.003, detail: 0.03, rough: [0.18, 0.32], jointRough: 0.9, ao: [260, 6, 0.35]},
  stone: {joint: 0.002, bevel: 0.0008, detail: 0.04, rough: [0.5, 0.65], jointRough: 0.85, ao: [260, 6, 0.35]},
  terrazzo: {joint: 0, bevel: 0, detail: 0.015, rough: [0.3, 0.45], jointRough: 0.35, ao: [200, 6, 0.35]},
  concrete: {joint: 0.008, bevel: 0.004, detail: 0.12, rough: [0.82, 0.95], jointRough: 0.95, ao: [90, 8, 0.35]},
  plaster: {joint: 0, bevel: 0, detail: 0.05, rough: [0.85, 0.95], jointRough: 0.95, ao: [120, 8, 0.35]},
  rock: {joint: 0, bevel: 0, detail: 0.08, rough: [0.8, 0.95], jointRough: 0.95, ao: [9, 24, 0.55]},
  enamel: {joint: 0.01, bevel: 0.002, detail: 0.02, rough: [0.3, 0.42], jointRough: 0.9, ao: [90, 8, 0.35]},
  metal: {joint: 0.02, bevel: 0.002, detail: 0.02, rough: [0.38, 0.5], jointRough: 0.9, ao: [60, 10, 0.35]},
};
/** Set-specific overrides of the class (the plinth's honed granite is a touch smoother than the floor's; limestone rougher). */
const OVERRIDE = {plinthGranite: {rough: [0.45, 0.6]}, stoneLimestone: {rough: [0.65, 0.8]}};

const rows = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// ---------- numeric helpers (deterministic, wrap-around where the image is periodic) ----------
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const l2s = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; };
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
/** ~Gaussian blur: three box passes. */
const blurWrap = (src, w, h, r) => (r < 1 ? Float32Array.from(src) : boxWrap(boxWrap(boxWrap(src, w, h, r), w, h, r), w, h, r));
/** Moving median high-pass of a 1-D profile (wrap or clamp). */
function highPass(p, win, wrap) {
  const n = p.length, r = win >> 1, out = new Float64Array(n), buf = new Float64Array(2 * r + 1);
  for (let i = 0; i < n; i++) {
    for (let d = -r; d <= r; d++) buf[d + r] = p[wrap ? ((i + d) % n + n) % n : Math.min(n - 1, Math.max(0, i + d))];
    buf.sort(); out[i] = p[i] - buf[r];
  }
  return out;
}
/** Joint lines of a 1-D score profile (already signed: joints positive): weighted centroids of the runs above the threshold. */
function lines(score, {minRel = 0.35} = {}) {
  const n = score.length, mad = median(Array.from(score, Math.abs)), thr = Math.max(3, 4 * mad), runs = [];
  for (let i = 0; i < n;) {
    if (score[i] > thr) {
      let j = i, sw = 0, sx = 0, peak = 0;
      for (; j < n && score[j] > thr; j++) { sw += score[j]; sx += score[j] * j; peak = Math.max(peak, score[j]); }
      runs.push({at: sx / sw, peak}); i = j;
    } else i++;
  }
  const top = median(runs.map(r => r.peak).sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(runs.length / 2))));
  // one joint can show as two runs (a dark edge each side of the grout): runs closer than 8 px merge (peak-weighted)
  const merged = [];
  for (const r of runs.filter(r => r.peak >= minRel * top)) {
    const last = merged[merged.length - 1];
    if (last && r.at - last.at < 8) { const w = last.peak + r.peak; merged[merged.length - 1] = {at: (last.at * last.peak + r.at * r.peak) / w, peak: Math.max(last.peak, r.peak)}; }
    else merged.push(r);
  }
  return merged;
}
/**
 * Regularly spaced joint lines of a signed 1-D score profile (joints positive): the step = the autocorrelation peak within 0.6-1.5x
 * `guess`, refined with the phase by a comb fit (mean score of the teeth inside the profile); each tooth then moves to the score-weighted
 * centroid within +-3 px of its local maximum; teeth weaker than 35 % of the median tooth are dropped (an edge without a joint).
 */
function periodicLines(score, guess) {
  const n = score.length;
  let lag0 = 0, best = -Infinity;
  for (let lag = Math.max(6, Math.floor(0.6 * guess)); lag <= Math.min(n / 2, Math.ceil(1.5 * guess)); lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += score[i] * score[i + lag];
    s /= n - lag;
    if (s > best) { best = s; lag0 = lag; }
  }
  const at = q => { const i = Math.floor(q), f = q - i; return i < 0 || i + 1 >= n ? 0 : (1 - f) * score[i] + f * score[i + 1]; };
  let fit = {step: lag0, phase: 0, score: -Infinity};
  for (let st = lag0 - 1.5; st <= lag0 + 1.5 + 1e-9; st += 0.02) for (let p = 0; p < st; p += 0.25) {
    let s = 0, k = 0; for (let q = p; q < n - 1; q += st, k++) s += at(q);
    if (k && s / k > fit.score) fit = {step: st, phase: p, score: s / k};
  }
  const teeth = [];
  for (let q = fit.phase; q < n - 1; q += fit.step) {
    const c = Math.round(q); let bi = c, bv = -Infinity;
    for (let d = -3; d <= 3; d++) { const i = c + d; if (i >= 0 && i < n && score[i] > bv) { bv = score[i]; bi = i; } }
    let sw = 0, sx = 0; for (let d = -3; d <= 3; d++) { const i = bi + d; if (i >= 0 && i < n && score[i] > 0) { sw += score[i]; sx += score[i] * i; } }
    teeth.push({at: sw ? sx / sw : bi, peak: bv});
  }
  const med = median(teeth.map(t => t.peak));
  return {step: fit.step, lines: teeth.filter(t => t.peak >= 0.35 * med && t.peak > 0).map(t => t.at)};
}
/** Per-row / per-column profiles of a joint score image (luminance, or brass hue for 'brass'). */
function profiles(rgb, w, h, grout) {
  const prow = new Float64Array(h), pcol = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const v = grout === 'brass' ? 255 * Math.min(1, Math.max(0, ((r - b) - 30) / 60)) * (r >= g ? 1 : 0.5) : lumOf(r, g, b);
    prow[y] += v / w; pcol[x] += v / h;
  }
  return {prow, pcol};
}
const polarity = grout => (grout === 'light' || grout === 'brass' ? 1 : -1);

/** Wrap seam vs interior neighbours (mean abs grey difference, 0..255), as the Skyways tool. */
function seamCheck(grey, W, H, periods = [1, 1]) {
  const g = (x, y) => grey[y * W + x];
  const col = (a, b) => { let s = 0; for (let y = 0; y < H; y++) s += Math.abs(g(a, y) - g(b, y)); return s / H; };
  const row = (a, b) => { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(g(x, a) - g(x, b)); return s / W; };
  const r1 = v => Math.round(v * 10) / 10;
  const mid = n => Math.floor(n / 2);
  let mLR = 0, mTB = 0;
  for (let x = 0; x + 1 < W; x++) mLR += col(x, x + 1) / (W - 1);
  for (let y = 0; y + 1 < H; y++) mTB += row(y, y + 1) / (H - 1);
  // phase-matched: the same position in every other whole period (a period crop's seam sits on a joint, like those pairs)
  const phase = (n, k, f) => { if (k < 2) return null; let s = 0; for (let i = 1; i < k; i++) { const x = Math.round(i * n / k); s += f(x - 1, x); } return s / (k - 1); };
  const pLR = phase(W, periods[0], col), pTB = phase(H, periods[1], row);
  const seamLR = col(W - 1, 0), seamTB = row(H - 1, 0);
  // interior* = the Skyways tool's two sample pairs; mean* = every neighbour pair; phase* = phase-matched pairs (period crops);
  // ratio = seam / (phase-matched mean when there are >= 2 periods, else the all-pairs mean)
  return {seamLR: r1(seamLR), interiorLR: r1((col(mid(W) - 1, mid(W)) + col(1, 2)) / 2), meanLR: r1(mLR), ...(pLR !== null ? {phaseLR: r1(pLR)} : {}), ratioLR: r3(seamLR / Math.max(0.1, pLR ?? mLR)),
    seamTB: r1(seamTB), interiorTB: r1((row(mid(H) - 1, mid(H)) + row(1, 2)) / 2), meanTB: r1(mTB), ...(pTB !== null ? {phaseTB: r1(pTB)} : {}), ratioTB: r3(seamTB / Math.max(0.1, pTB ?? mTB))};
}
const greyOf = (rgb, n) => { const g = new Float32Array(n); for (let i = 0; i < n; i++) g[i] = Math.round(lumOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])); return g; };
/** Lighting: 3 x 3 cell medians of luminance -> corner-to-centre and spread (fractions of the mean). */
function lightGrid(rgb, W, H) {
  const cells = [];
  for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) {
    const v = [];
    for (let y = Math.floor(cy * H / 3); y < Math.floor((cy + 1) * H / 3); y += 2) for (let x = Math.floor(cx * W / 3); x < Math.floor((cx + 1) * W / 3); x += 2) { const i = (y * W + x) * 3; v.push(lumOf(rgb[i], rgb[i + 1], rgb[i + 2])); }
    cells.push(median(v));
  }
  const mean = cells.reduce((a, b) => a + b, 0) / 9;
  return {cornerToCentre: r3((cells[4] - (cells[0] + cells[2] + cells[6] + cells[8]) / 4) / mean), spread: r3((Math.max(...cells) - Math.min(...cells)) / mean)};
}
/** Low-frequency luminance field range (wrap blur ~1/3 of the image) as a fraction of its mean. */
function lowField(rgb, W, H) {
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = lumOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  const f = blurWrap(blurWrap(L, W, H, Math.round(Math.min(W, H) / 9)), W, H, Math.round(Math.min(W, H) / 9));
  let lo = Infinity, hi = -Infinity, s = 0;
  for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); s += v; }
  return {field: f, range: r3((hi - lo) / (s / f.length))};
}
const cosW = (d, B) => 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, d) / B)); // 1 at d = 0 -> 0 at d = B

// ---------- per-set processing ----------
async function processSet(key, s) {
  // --- ledger / prompt / raw verification ---
  const okRows = rows.filter(r => r.event === 'result' && r.kind === 'codex-image' && r.id === s.id && r.status === 'ok' && r.rc === 0);
  const res = okRows.find(r => r.n === s.call);
  if (!res) fail(`${key}: no ok ledger result row for call ${s.call} (${s.id})`);
  const latest = okRows.reduce((m, r) => Math.max(m, r.n), 0);
  if (latest !== s.call) console.warn(`build-subway-arch-textures: ${key}: a newer ok call ${latest} exists for ${s.id} (pinned ${s.call})`);
  if (!Array.isArray(res.files) || res.files.length !== 1) fail(`${key}: call ${s.call} is not a single-image result`);
  const intent = rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.n === s.call && r.id === s.id && r.t < res.t).pop();
  if (!intent) fail(`${key}: no intent row before the result of call ${s.call}`);
  const file = res.files[0];
  const raw = fs.readFileSync(path.join(GEN, file.raw));
  if (sha(raw) !== file.sha256 || raw.length !== file.bytes) fail(`${key}: ${file.raw} does not match its ledger row`);
  if (s.sha256 && s.sha256 !== file.sha256) fail(`${key}: pinned source sha256 ${s.sha256} != ledger ${file.sha256}`);
  // the helper froze `full + '\n'` and hashed `full`
  const frozen = fs.readFileSync(path.join(GEN, 'prompts', intent.promptFile), 'utf8');
  const full = frozen.endsWith('\n') ? frozen.slice(0, -1) : frozen;
  if (sha(Buffer.from(full)) !== intent.promptSha256) fail(`${key}: ${intent.promptFile} differs from the ledgered prompt`);
  const session = res.session ?? /generated_images\/([0-9a-f-]{36})\//.exec(file.src)?.[1];
  if (!/^[0-9a-f-]{36}$/.test(session ?? '')) fail(`${key}: no Codex session id`);

  const {data: src, info} = await sharp(raw).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject: true});
  const W = info.width, H = info.height;
  const pol = polarity(s.grout);

  // --- a. joint lines on the source + period crop per axis ---
  const {prow, pcol} = profiles(src, W, H, s.grout);
  const win = s.hp ?? 31;
  const found = {u: lines(Float64Array.from(highPass(pcol, win, false), v => v * pol)), v: lines(Float64Array.from(highPass(prow, win, false), v => v * pol))};
  const ax = {};
  for (const a of ['u', 'v']) {
    const c = s[a];
    if (c.mode !== 'joints') continue;
    // the joint step: autocorrelation peak near the prompt's nominal step (0.6-1.5x), then a comb (step, phase) fit refined per tooth
    const prof = Float64Array.from(highPass(a === 'u' ? pcol : prow, win, false), v => v * pol);
    const per = periodicLines(prof, (c.module / c.steps) / (s.frame / W));
    const L = per.lines;
    if (L.length < 2) fail(`${key}: ${a}: expected joint lines, found ${L.length}`);
    const step = per.step;
    const B = Math.max(8, Math.min(40, Math.round(0.35 * step)));
    let best = null;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const n = Math.round((L[j] - L[i]) / step);
      if (n < c.steps || n % c.steps || Math.abs(L[j] - L[i] - n * step) > 0.15 * step || L[i] < B) continue;
      if (!best || n > best.n || (n === best.n && Math.abs(L[j] - L[i] - n * step) < best.err)) best = {i, j, n, err: Math.abs(L[j] - L[i] - n * step)};
    }
    if (!best) fail(`${key}: ${a}: no whole-period joint pair`);
    const x0 = Math.round(L[best.i]), x1 = Math.round(L[best.j]);
    const periodPx = (L[best.j] - L[best.i]) / best.n * c.steps;
    ax[a] = {mode: 'joints', start: x0, size: x1 - x0, periods: best.n / c.steps, periodPx, mPerPx: c.module / periodPx, feather: B, lines: L.length, stepPx: r3(step),
      why: `from joint centre ${r3(L[best.i])} to joint centre ${r3(L[best.j])}: ${best.n / c.steps} whole periods of ${r3(periodPx)} px (${c.steps} joint line${c.steps > 1 ? 's' : ''} per period)`};
  }
  for (const a of ['u', 'v']) {
    const c = s[a], len = a === 'u' ? W : H, o = a === 'u' ? 'v' : 'u';
    if (c.mode === 'joints') continue;
    const mPerPx = ax[o]?.mode === 'joints' ? ax[o].mPerPx : s.frame / W; // square pixels from the measured axis, else the prompt's frame
    if (c.mode === 'none') { ax[a] = {mode: 'none', start: 0, size: len, periods: 1, periodPx: len, mPerPx, feather: 0, why: 'jointless: the full frame'}; continue; }
    const strongest = [...found[a]].sort((x, y) => y.peak - x.peak)[0];
    if (!strongest) fail(`${key}: ${a}: no joint line`);
    const P = c.module / mPerPx, j = strongest.at;
    let start, size = Math.round(P), B, why;
    if (size >= len - 2) { start = 0; size = len; B = 0; why = `one joint per frame at ${r3(j)}: the frame is one ${c.module} m period`; }
    else if ((s.singleCrop ?? 'joint') === 'joint' && Math.round(j) + size <= len) {
      // one whole source slab / panel, starting ON the joint centre (the wrap seam lies in the joint, where a tone change is natural);
      // a narrow end feather completes the joint's other half from the source just before the start
      start = Math.round(j); B = Math.min(start, 6);
      why = `one period (${r3(P)} px = ${c.module} m) starting on the joint at ${r3(j)}: one whole source panel (inferred scale ${r4(mPerPx * 1000)} mm/px)`;
    } else {
      start = Math.round(j - P / 2);
      if (start < 0 || start + size > len) fail(`${key}: ${a}: one period around the joint leaves the frame`);
      B = Math.min(start, Math.max(16, Math.min(96, Math.round(P / 6))));
      why = `one period (${r3(P)} px = ${c.module} m) centred on the joint at ${r3(j)} (inferred scale ${r4(mPerPx * 1000)} mm/px)`;
    }
    ax[a] = {mode: 'single', start, size, periods: 1, periodPx: size === len ? len : P, mPerPx: c.module / (size === len ? len : P), feather: B, joint: r3(j), why};
  }
  const cw = ax.u.size, ch = ax.v.size, x0 = ax.u.start, y0 = ax.v.start;

  // --- b. crop + wrap feather with the source's own continuation ---
  const Bu = ax.u.feather, Bv = ax.v.feather;
  const plain = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let k = 0; k < 3; k++) plain[(y * cw + x) * 3 + k] = src[((y0 + y) * W + x0 + x) * 3 + k];
  // strip T: rows [y0 - Bv, y0 + ch), cols [0, cw), u-feathered
  const TH = ch + Bv, T = new Float32Array(cw * TH * 3);
  for (let r = 0; r < TH; r++) {
    const sy = y0 - Bv + r;
    for (let x = 0; x < cw; x++) {
      const d = cw - x; // 1 at the last column
      const w = Bu && d <= Bu ? cosW(d - 0.5, Bu) : 0;
      for (let k = 0; k < 3; k++) {
        const a = src[(sy * W + x0 + x) * 3 + k];
        T[(r * cw + x) * 3 + k] = w ? (1 - w) * a + w * src[(sy * W + x0 - d) * 3 + k] : a;
      }
    }
  }
  let work = new Float32Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    const d = ch - y, w = Bv && d <= Bv ? cosW(d - 0.5, Bv) : 0;
    for (let x = 0; x < cw; x++) for (let k = 0; k < 3; k++) {
      const a = T[((y + Bv) * cw + x) * 3 + k];
      work[(y * cw + x) * 3 + k] = w ? (1 - w) * a + w * T[((Bv - d) * cw + x) * 3 + k] : a;
    }
  }
  // full-frame axes: measure the wrap seam; clearly worse than the interior -> feathered band from a joint-free interior strip
  const patch = {};
  const PB = s.patchBand ?? 48;
  for (const a of ['u', 'v']) {
    if (ax[a].feather || ax[a].size !== (a === 'u' ? W : H)) continue;
    const g = greyOf(work, cw * ch), sc = seamCheck(g, cw, ch);
    const seam = a === 'u' ? sc.seamLR : sc.seamTB, inner = a === 'u' ? sc.meanLR : sc.meanTB;
    const ratio = a === 'u' ? sc.ratioLR : sc.ratioTB;
    patch[a] = {seam, meanNeighbour: inner, ratio, applied: ratio > 1.25};
    if (!patch[a].applied) continue;
    const at = Math.round((s.patchAt ?? 0.5) * (a === 'u' ? cw : ch));
    patch[a].bandAt = at; patch[a].band = PB;
    const next = Float32Array.from(work);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = a === 'u' ? x : y, n = a === 'u' ? cw : ch;
      const o = p >= n - PB ? p - n : p < PB ? p : null;
      if (o === null) continue;
      const al = cosW(Math.abs(o + 0.5), PB);
      const sx = a === 'u' ? at + o : x, sy = a === 'u' ? y : at + o;
      for (let k = 0; k < 3; k++) next[(y * cw + x) * 3 + k] = (1 - al) * work[(y * cw + x) * 3 + k] + al * work[(sy * cw + sx) * 3 + k];
    }
    work = next;
  }

  // --- c. lighting: measure; flatten only above the threshold (sets with legit panel-to-panel tone never flatten) ---
  const workU8 = Uint8Array.from(work, v => Math.round(Math.min(255, Math.max(0, v))));
  const lightBefore = lightGrid(workU8, cw, ch), lowBefore = lowField(workU8, cw, ch);
  const mayFlatten = !['stone', 'enamel', 'concrete'].includes(s.cls);
  const flatten = {threshold: {cornerToCentre: 0.04, lowRange: 0.08}, eligible: mayFlatten, before: {...lightBefore, lowRange: lowBefore.range}, applied: false};
  if (mayFlatten && (Math.abs(lightBefore.cornerToCentre) > 0.04 || lowBefore.range > 0.08)) {
    const f = lowBefore.field, mean = f.reduce((a, b) => a + b, 0) / f.length;
    for (let i = 0; i < cw * ch; i++) { const gain = mean / Math.max(1, f[i]); for (let k = 0; k < 3; k++) workU8[i * 3 + k] = l2s(s2l(workU8[i * 3 + k]) * gain); }
    flatten.applied = true;
  }

  // --- d. wrap-exact resize: 3 x 3 tiled crop -> 3N, centre extract ---
  const resize = async (img, w, h) => {
    const big = new Uint8Array(9 * w * h * 3), bw = 3 * w;
    for (let ty = 0; ty < 3; ty++) for (let y = 0; y < h; y++) for (let tx = 0; tx < 3; tx++) big.set(img.subarray(y * w * 3, (y + 1) * w * 3), ((ty * h + y) * bw + tx * w) * 3);
    return (await sharp(big, {raw: {width: bw, height: 3 * h, channels: 3}}).resize(3 * N, 3 * N, {kernel: 'lanczos3', fit: 'fill'})
      .extract({left: N, top: N, width: N, height: N}).raw().toBuffer());
  };
  const rgb = await resize(workU8, cw, ch);
  const plainRgb = await resize(plain, cw, ch);
  const colorJpg = await sharp(rgb, {raw: {width: N, height: N, channels: 3}}).toColourspace('srgb').jpeg({quality: Q.color, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const decode = async b => (await sharp(b).removeAlpha().raw().toBuffer());
  const colDec = await decode(colorJpg);
  // seams are measured on the pre-JPEG buffers (the wrap is always an 8 x 8 block edge; the codec is not part of the seam)
  const per = [Math.round(ax.u.periods), Math.round(ax.v.periods)];
  const seamBefore = seamCheck(greyOf(plainRgb, N * N), N, N, per), seamAfter = seamCheck(greyOf(rgb, N * N), N, N, per);
  const lightAfter = lightGrid(colDec, N, N);
  flatten.after = {...lightAfter, lowRange: lowField(colDec, N, N).range};

  // --- e. joints on the final (periodic) map -> joint distance field ---
  const NN = N * N, L = new Float32Array(NN);
  for (let i = 0; i < NN; i++) L[i] = lumOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) / 255;
  const fp = profiles(rgb, N, N, s.grout);
  const comb = (prof, step, refine = 3) => { // phase of a periodic comb of `step` maximising the signed score, teeth refined locally
    const n = prof.length, teeth = Math.max(1, Math.round(n / step)), st = n / teeth;
    let bestP = 0, bestS = -Infinity;
    for (let p = 0; p < st; p += 0.5) { let sc = 0; for (let t = 0; t < teeth; t++) { const q = p + t * st, i = Math.floor(q), f = q - i; sc += (1 - f) * prof[i % n] + f * prof[(i + 1) % n]; } if (sc > bestS) { bestS = sc; bestP = p; } }
    const out = [];
    for (let t = 0; t < teeth; t++) {
      const c = Math.round(bestP + t * st); let bi = c, bv = -Infinity;
      for (let d = -refine; d <= refine; d++) { const i = ((c + d) % n + n) % n; if (prof[i] > bv) { bv = prof[i]; bi = c + d; } }
      // sub-pixel centroid over +-1
      const a = prof[((bi - 1) % n + n) % n], b = prof[((bi) % n + n) % n], cc = prof[((bi + 1) % n + n) % n], den = a - 2 * b + cc;
      out.push(((bi + (den < 0 ? 0.5 * (a - cc) / den : 0)) % n + n) % n);
    }
    return {at: out.sort((x, y) => x - y), phase: bestP, step: st};
  };
  const outStep = a => (s[a].mode === 'joints' ? (ax[a].periodPx / s[a].steps) * N / (a === 'u' ? cw : ch) : s[a].mode === 'single' ? N * ax[a].periodPx / ax[a].size : 0);
  const hpWin = Math.max(15, Math.round((s.hp ?? 31) * N / Math.max(cw, ch)) | 1);
  const rowScore = Float64Array.from(highPass(fp.prow, hpWin, true), v => v * pol);
  const rowJ = s.v.mode === 'none' ? [] : comb(rowScore, outStep('v')).at;
  // per course (the band between two row joints) the vertical joints: running bond / stack bond / panels
  const colPeriodOut = s.u.mode === 'joints' ? ax.u.periodPx * N / cw : s.u.mode === 'single' ? N * ax.u.periodPx / ax.u.size : 0;
  // one global phase for every course (running bond: odd courses offset by half a tile — every course votes, so dark glaze crazing
  // cannot pull a course off its joints), each joint then refined locally (+-3 px)
  const courses = [];
  const courseBounds = rowJ.length ? rowJ.map((y, i) => [y, i + 1 < rowJ.length ? rowJ[i + 1] : rowJ[0] + N]) : [[0, N]];
  const running = s.u.mode === 'joints' && s.u.steps === 2;
  if (running && courseBounds.length % 2) fail(`${key}: a running bond needs an even number of courses per repeat (found ${courseBounds.length})`);
  const scores = courseBounds.map(([ya, yb]) => {
    if (!colPeriodOut) return null;
    const m = rowJ.length ? 6 : 0, pc = new Float64Array(N);
    let cnt = 0;
    for (let yy = Math.ceil(ya + m); yy <= Math.floor(yb - m); yy++) { const y = yy % N; cnt++; for (let x = 0; x < N; x++) pc[x] += lumOrBrass(rgb, (y * N + x) * 3, s.grout); }
    for (let x = 0; x < N; x++) pc[x] /= Math.max(1, cnt);
    return Float64Array.from(highPass(pc, hpWin, true), v => v * pol);
  });
  const at = (p, q) => { const i = Math.floor(q), f = q - i; return (1 - f) * p[((i % N) + N) % N] + f * p[(((i + 1) % N) + N) % N]; };
  let bond = null;
  if (colPeriodOut) {
    const teeth = Math.max(1, Math.round(N / colPeriodOut)), st = N / teeth;
    const fit = half => { let bp = 0, bs = -Infinity; for (let p = 0; p < st; p += 0.5) { let sc = 0; scores.forEach((pr, k) => { const o = half && k % 2 ? st / 2 : 0; for (let t = 0; t < teeth; t++) sc += at(pr, p + o + t * st); }); if (sc > bs) { bs = sc; bp = p; } } return {p: bp, score: bs}; };
    const model = fit(running);
    if (running) {
      const alt = fit(false); // the same joints in every course (stack bond): a real running bond scores clearly lower there
      bond = {courses: courseBounds.length, score: r3(model.score), stackAlternative: r3(alt.score), ok: model.score > 1.5 * Math.max(alt.score, 0)};
      if (!bond.ok && !DEBUG_DIR) fail(`${key}: the running bond's half offset does not survive the wrap (score ${bond.score} vs stack ${bond.stackAlternative})`);
    }
    courseBounds.forEach(([ya, yb], k) => {
      const pr = scores[k], o = running && k % 2 ? st / 2 : 0, xs = [];
      for (let t = 0; t < teeth; t++) {
        const c = Math.round(model.p + o + t * st); let bi = c, bv = -Infinity;
        for (let d = -3; d <= 3; d++) { const v = pr[(((c + d) % N) + N) % N]; if (v > bv) { bv = v; bi = c + d; } }
        const a = pr[(((bi - 1) % N) + N) % N], b = pr[((bi % N) + N) % N], cc = pr[(((bi + 1) % N) + N) % N], den = a - 2 * b + cc;
        xs.push((((bi + (den < 0 ? 0.5 * (a - cc) / den : 0)) % N) + N) % N);
      }
      courses.push({ya, yb, xs: xs.sort((x, y) => x - y)});
    });
  } else for (const [ya, yb] of courseBounds) courses.push({ya, yb, xs: []});
  // joint distance (px) per pixel
  const dist = new Float32Array(NN).fill(1e9);
  const wrapD = (a, b) => { const d = Math.abs(a - b) % N; return Math.min(d, N - d); };
  for (let y = 0; y < N; y++) {
    let dr = 1e9; for (const j of rowJ) dr = Math.min(dr, wrapD(y, j));
    const c = courses.find(c => (y >= c.ya && y < c.yb) || (y + N >= c.ya && y + N < c.yb)) ?? courses[0];
    for (let x = 0; x < N; x++) { let dc = 1e9; for (const j of c.xs) dc = Math.min(dc, wrapD(x, j)); dist[y * N + x] = Math.min(dr, dc); }
  }
  // joint half width from the averaged row / column joint profile (FWHM), px
  const halfWidth = (() => {
    const prof = rowJ.length ? rowScore : null;
    const use = prof ?? Float64Array.from(highPass(fp.pcol, hpWin, true), v => v * pol), at = rowJ.length ? rowJ : courses[0].xs;
    if (!at.length) return 0;
    const acc = new Float64Array(41);
    for (const j of at) for (let d = -20; d <= 20; d++) acc[d + 20] += use[((Math.round(j) + d) % N + N) % N] / at.length;
    const peak = acc[20], base = median([...acc.slice(0, 8), ...acc.slice(33)]), half = base + (peak - base) / 2;
    let l = 20, r = 20; while (l > 0 && acc[l - 1] > half) l--; while (r < 40 && acc[r + 1] > half) r++;
    return Math.max(0.75, (r - l + 1) / 2);
  })();

  if (DEBUG_DIR) {
    const dbg = Buffer.from(rgb);
    for (let i = 0; i < NN; i++) if (dist[i] < 0.6) { dbg[i * 3] = 255; dbg[i * 3 + 1] = 0; dbg[i * 3 + 2] = 255; }
    fs.mkdirSync(DEBUG_DIR, {recursive: true});
    await sharp(dbg, {raw: {width: N, height: N, channels: 3}}).png().toFile(path.join(DEBUG_DIR, `${key}-joints.png`));
    console.error(`debug ${key}: rows ${rowJ.map(r3).join(' ')} | course0 ${courses[0]?.xs.map(r3).join(' ')} | course1 ${courses[1]?.xs.map(r3).join(' ')} | bond ${JSON.stringify(bond)}`);
  }
  // --- height (m) ---
  const C = {...CLASS[s.cls], ...(OVERRIDE[key] ?? {})};
  const spanU = r4(cw * ax.u.mPerPx), spanV = r4(ch * ax.v.mPerPx);
  const tU = spanU / N, tV = spanV / N; // metres per output texel
  const texel = Math.min(tU, tV), bevelPx = C.bevel / texel;
  const Hm = new Float32Array(NN), joint = new Float32Array(NN);
  const Lb1 = blurWrap(L, N, N, 1), Lb12 = blurWrap(L, N, N, 12);
  let dSd = 0; for (let i = 0; i < NN; i++) dSd += (Lb12[i] - Lb1[i]) ** 2; dSd = Math.sqrt(dSd / NN) || 1;
  for (let i = 0; i < NN; i++) {
    const d = dist[i];
    const core = 1 - smooth(halfWidth - 0.75, halfWidth + 0.75, d);
    const shoulder = bevelPx > 0 ? Math.pow(1 - smooth(halfWidth, halfWidth + bevelPx, d), 2) : 0;
    joint[i] = core;
    const cav = Math.max(-2.5, Math.min(2.5, (Lb1[i] - Lb12[i]) / dSd)); // + = brighter than its surroundings
    Hm[i] = -C.joint * Math.max(core, 0.45 * shoulder) + C.detail * texel * cav * (1 - core);
  }
  if (s.cls === 'rock') { // painted shotcrete: luminance ~ the soft AO of its 10-40 cm lumps -> height, multi-scale
    const pxM = Math.min(tU, tV), bands = [[0.012, 0.06, 0.0015], [0.035, 0.18, 0.004], [0.09, 0.45, 0.008]]; // [blur m, base m, amplitude m]
    for (const [rb, rbase, amp] of bands) {
      const a = blurWrap(L, N, N, Math.max(1, Math.round(rb / pxM / 2))), b = blurWrap(L, N, N, Math.max(2, Math.round(rbase / pxM / 2)));
      let sd = 0; for (let i = 0; i < NN; i++) sd += (a[i] - b[i]) ** 2; sd = Math.sqrt(sd / NN) || 1;
      for (let i = 0; i < NN; i++) Hm[i] += amp * Math.max(-3, Math.min(3, (a[i] - b[i]) / sd));
    }
  }
  // --- normal (the Reactor kit convention: R = -dx, G = +dy (image y down), B = z), slopes in metres per metre ---
  const Hs = blurWrap(Hm, N, N, 1);
  const nrm = Buffer.alloc(NN * 3), orm = Buffer.alloc(NN * 3);
  const cavity = blurWrap(Hm, N, N, C.ao[1]);
  const Lb3 = blurWrap(L, N, N, 3);
  let tSd = 0; for (let i = 0; i < NN; i++) tSd += (Lb12[i] - Lb3[i]) ** 2; tSd = Math.sqrt(tSd / NN) || 1;
  const brass = s.grout === 'brass';
  let metalPx = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dx = (Hs[y * N + (x + 1) % N] - Hs[y * N + (x - 1 + N) % N]) / (2 * tU), dy = (Hs[((y + 1) % N) * N + x] - Hs[((y - 1 + N) % N) * N + x]) / (2 * tV);
    const l = Math.hypot(dx, dy, 1);
    nrm[i * 3] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[i * 3 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nrm[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    const inJoint = joint[i] > 0.5;
    const ao = Math.min(1, Math.max(inJoint ? 0.15 : C.ao[2], 1 - Math.max(0, cavity[i] - Hm[i]) * C.ao[0]));
    const t = Math.min(1, Math.max(0, 0.5 + 0.5 * (Lb12[i] - Lb3[i]) / tSd)); // darker than its surroundings -> rougher
    let rough = C.rough[0] + (C.rough[1] - C.rough[0]) * t;
    let metal = 0;
    if (brass) {
      const r8 = rgb[i * 3], g8 = rgb[i * 3 + 1], b8 = rgb[i * 3 + 2];
      const hue = Math.min(1, Math.max(0, ((r8 - b8) - 30) / 50)) * (r8 >= g8 && g8 > b8 ? 1 : 0);
      const strip = (1 - smooth(halfWidth + 0.5, halfWidth + 2, dist[i])) * hue;
      metal = 0.9 * strip; rough = rough + (C.jointRough - rough) * strip;
      if (strip > 0.5) metalPx++;
    } else rough = rough + (C.jointRough - rough) * joint[i];
    orm[i * 3] = Math.round(ao * 255); orm[i * 3 + 1] = Math.round(Math.min(1, rough) * 255); orm[i * 3 + 2] = Math.round(metal * 255);
  }
  const normalJpg = await sharp(nrm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: Q.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const ormJpg = await sharp(orm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: Q.orm, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();

  if (DEBUG_DIR) for (const [m, b] of [['color', colorJpg], ['normal', normalJpg], ['orm', ormJpg]]) fs.writeFileSync(path.join(DEBUG_DIR, `${key}-${m}.jpg`), b);
  // --- f. linear mean albedo of the final colour map, mean roughness of the final ORM ---
  const mean = [0, 0, 0];
  for (let i = 0; i < NN; i++) for (let k = 0; k < 3; k++) mean[k] += s2l(colDec[i * 3 + k]) / NN;
  const ormDec = await decode(ormJpg);
  let rough = 0; for (let i = 0; i < NN; i++) rough += ormDec[i * 3 + 1] / 255 / NN;

  const name = s.id, base = `${OUT_DIR_REL}/subway-arch-${name}`;
  const out = {color: {url: `${base}-color.jpg`, buf: colorJpg}, normal: {url: `${base}-normal.jpg`, buf: normalJpg}, orm: {url: `${base}-orm.jpg`, buf: ormJpg}};
  const provRel = `${PROV_DIR_REL}/subway-arch-${name}.json`;
  const axisRec = a => ({mode: ax[a].mode, module: s[a].module ?? null, cropStart: ax[a].start, cropSize: ax[a].size, periods: r3(ax[a].periods), periodPx: r3(ax[a].periodPx),
    mmPerPx: r4(ax[a].mPerPx * 1000), featherPx: ax[a].feather, ...(ax[a].stepPx ? {jointStepPx: ax[a].stepPx, jointLines: ax[a].lines} : {}), why: ax[a].why});
  const prov = {schema: 'last-line-derivative/1', asset: `subway-arch-${name}`, task: TASK, lane: 'TEX',
    status: "runtime PBR derivative (period crop / seam feather / resize / derived normal + ORM / JPEG; deterministic processing only) of an ORIGINAL tileable surface texture generated for this project with Codex native image_gen (owned Codex CLI) under the user's explicit authorization for the Subway architecture + materials rework; provider terms apply; unapproved prototype, no licence or commercial clearance implied",
    use: s.use, subject: s.subject, cls: s.cls,
    rebuild: 'node tools/asset-pipeline/props/build-subway-arch-textures.mjs',
    rawStorage: `${TASK_REL}/gen/{LEDGER.jsonl, raw/codex-<n>-<id>-exec-<uuid>.png, prompts/frozen/<id>-c<n>.txt} (private, outside Git)`,
    generator: GENERATOR,
    codex: {generator: GENERATOR, ledgerCall: s.call, session, requested: intent.t, finished: res.t, seconds: res.seconds, imageGenGenerations: res.imageGenGenerations ?? null},
    prompt: {file: intent.promptFile, sha256: intent.promptSha256},
    source: {file: path.basename(file.raw), sha256: file.sha256, bytes: raw.length, width: W, height: H},
    recipe: {
      jointPolarity: s.grout, profileHighPassPx: win,
      crop: {x: x0, y: y0, w: cw, h: ch, u: axisRec('u'), v: axisRec('v')},
      seam: {feather: 'cropped axes: the last featherPx columns / rows cross-fade (cosine) into the source pixels just before the crop start (the true wrap neighbours)',
        fullFramePatch: Object.keys(patch).length ? {...patch, method: `seam ratio > 1.25: a ${PB} px cosine-feathered band from the interior strip at patchAt (joint-free) laid across the wrap`} : null},
      lighting: flatten,
      resize: {width: N, height: N, kernel: 'lanczos3', fit: 'fill', wrap: '3 x 3 tiled, centre extract'},
      height: {jointDepthM: C.joint, bevelM: C.bevel, detailSlope: C.detail, jointHalfWidthPx: r3(halfWidth), rowJoints: rowJ.length, courses: courses.length, runningBond: bond,
        ...(s.cls === 'rock' ? {rockRelief: 'multi-scale luminance band-pass (12 / 35 / 90 mm blur over 60 / 180 / 450 mm bases, 1.5 / 4 / 8 mm per standard deviation)'} : {})},
      normal: {convention: 'tangent space, R = -dh/dx, G = +dh/dy (image y down), B = z (build-reactor-kit.mjs)', slopes: 'metres per metre from the height (m) and the span per texel'},
      orm: {r: 'ambient occlusion from cavity', g: `roughness ${C.rough[0]}-${C.rough[1]} faces, ${C.jointRough} ${brass ? 'brass strips' : 'joints / gaps'}`, b: brass ? `metalness 0.9 on brass strip pixels (${metalPx} px), else 0` : 'metalness 0',
        aoGainPerM: C.ao[0], aoBlurPx: C.ao[1], aoFloor: C.ao[2]},
      encode: {color: {quality: Q.color, mozjpeg: true, chromaSubsampling: '4:2:0'}, normal: {quality: Q.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}, orm: {quality: Q.orm, mozjpeg: true, chromaSubsampling: '4:4:4'}, metadata: 'stripped'},
      tool: 'sharp (libvips) + plain JS via tools/asset-pipeline/props/build-subway-arch-textures.mjs'},
    tileCheck: {before: seamBefore, after: seamAfter, note: 'mean absolute grey difference (0..255) across the wrap seams vs interior neighbour rows / columns (pre-JPEG 1024 buffers); phase = the same position in every other whole period; ratio = seam / phase (else / mean); before = the plain crop'},
    spanM: {u: spanU, v: spanV},
    meanLinearAlbedo: mean.map(r4), meanRoughness: r3(rough),
    outputs: Object.fromEntries(Object.entries(out).map(([k, o]) => [k, {url: o.url, bytes: o.buf.length, sha256: sha(o.buf), width: N, height: N, format: 'jpeg'}]))};
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\/).{0,20}/i);
  if (hit) fail(`URL / token / local-path-like string in public provenance: ...${hit[0]}...`);
  return {key, s, out, provRel, provBuf, span: [spanU, spanV], mean: mean.map(r4), rough: r3(rough), seamBefore, seamAfter, flatten, patch, ax, bond, halfWidth};
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lumOrBrass(rgb, i, grout) {
  const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
  return grout === 'brass' ? 255 * Math.min(1, Math.max(0, ((r - b) - 30) / 60)) * (r >= g ? 1 : 0.5) : lumOf(r, g, b);
}

// ---------- build ----------
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',') ?? null;
if (ONLY && !DRY) fail('--only is for dry runs (the registry / allowlist must list every set)');
const sets = [];
for (const [key, s] of Object.entries(SOURCES)) if (!ONLY || ONLY.includes(key)) sets.push(await processSet(key, s));

const outputs = [];
for (const t of sets) { for (const o of Object.values(t.out)) outputs.push({path: o.url, buf: o.buf}); outputs.push({path: t.provRel, buf: t.provBuf}); }

const tsText = [
  `// GENERATED by tools/asset-pipeline/props/build-subway-arch-textures.mjs — do not edit (task ${TASK}, lane TEX).`,
  "// The Subway architecture rework's ORIGINAL Codex-generated tileable surface sets (Codex native image_gen colour sources; period crop /",
  '// seam feather / resize; normal + ORM derived locally). Provenance assets/derivatives/subway-arch-<name>.json. Per set: colour (sRGB),',
  '// normal (tangent space, +Y up) and ORM (R ao, G roughness, B metalness) JPEGs; span = metres one repeat covers (u, v); mean = the',
  "// colour map's LINEAR mean albedo; rough = the ORM's mean roughness; cls = the material class.",
  "export type SubwayArchClass = 'tile' | 'stone' | 'terrazzo' | 'concrete' | 'plaster' | 'rock' | 'enamel' | 'metal';",
  'export interface SubwayArchFile { readonly url: string; readonly bytes: number }',
  'export interface SubwayArchSet {',
  '  readonly color: SubwayArchFile; readonly normal: SubwayArchFile; readonly orm: SubwayArchFile;',
  '  readonly span: readonly [number, number]; readonly mean: readonly [number, number, number]; readonly rough: number; readonly cls: SubwayArchClass;',
  '}',
  'export const SUBWAY_ARCH_TEXTURES = {',
  ...sets.map(t => `  ${t.key}: {color: {url: '${t.out.color.url}', bytes: ${t.out.color.buf.length}}, normal: {url: '${t.out.normal.url}', bytes: ${t.out.normal.buf.length}}, orm: {url: '${t.out.orm.url}', bytes: ${t.out.orm.buf.length}},\n    span: [${t.span[0]}, ${t.span[1]}], mean: [${t.mean.join(', ')}], rough: ${t.rough}, cls: '${t.s.cls}'},`),
  '} as const satisfies Readonly<Record<string, SubwayArchSet>>;',
  'export type SubwayArchTexKey = keyof typeof SUBWAY_ARCH_TEXTURES;',
  '',
].join('\n');

// CREDITS.md: the marked section
const credPath = path.join(PUB, CREDITS_REL);
const credSrc = fs.readFileSync(credPath, 'utf8');
const firstCalls = sets.every(t => rows.filter(r => r.event === 'intent' && r.kind === 'codex-image' && r.id === t.s.id && r.n < t.s.call).length === 0);
const credSection = [CREDITS_BEGIN, '## Subway architecture: tileable surface sets (tile, stone, concrete, enamel, slats, terrazzo, granite, plaster, painted rock)', '',
  `Original tileable surface textures generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool), one ledgered call per texture (${sets.length} accepted calls${firstCalls ? ', each accepted at its first call' : ''}), under the user's explicit authorization for the Subway architecture + materials rework (task ${TASK}). Runtime derivatives by \`tools/asset-pipeline/props/build-subway-arch-textures.mjs\` (deterministic processing only: a crop to whole measured joint periods, a seam feather from the source's own pixels, resize, and normal / ORM maps derived locally from the colour source; provenance: \`assets/derivatives/subway-arch-<name>.json\`). Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters, prompts and the generation ledger are kept outside Git.`, '',
  ...sets.map(t => `- \`${OUT_DIR_REL}/subway-arch-${t.s.id}-{color,normal,orm}.jpg\` — ${t.s.subject} (Codex call ${t.s.call})`), CREDITS_END].join('\n');
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
const credText = credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`;
outputs.push({path: CREDITS_REL, buf: Buffer.from(credText)});

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) fail('unknown public-input policy schema');
const mine = new Set(outputs.map(f => f.path));
const nextAllow = {...allow, files: [...allow.files.filter(f => !mine.has(f.path) && !(f.path.startsWith(`${OUT_DIR_REL}/subway-arch-`) || f.path.startsWith(`${PROV_DIR_REL}/subway-arch-`))),
  ...outputs.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}))].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))};
const allowText = JSON.stringify(nextAllow, null, 2) + '\n';

const texBytes = outputs.filter(o => o.path.endsWith('.jpg')).reduce((n, o) => n + o.buf.length, 0);
console.log(JSON.stringify({task: TASK, sets: sets.map(t => ({key: t.key, call: t.s.call, crop: `${t.ax.u.start},${t.ax.v.start} ${t.ax.u.size}x${t.ax.v.size}`, span: t.span, mean: t.mean, rough: t.rough,
  seam: `LR ${t.seamBefore.ratioLR} -> ${t.seamAfter.ratioLR}, TB ${t.seamBefore.ratioTB} -> ${t.seamAfter.ratioTB}`,
  flatten: t.flatten.applied, c2c: `${t.flatten.before.cornerToCentre} -> ${t.flatten.after.cornerToCentre}`, low: `${t.flatten.before.lowRange} -> ${t.flatten.after.lowRange}`,
  patch: Object.fromEntries(Object.entries(t.patch).map(([a, p]) => [a, `${p.ratio}${p.applied ? ' patched' : ''}`])), bond: t.bond ? `${t.bond.score}/${t.bond.stackAlternative}` : null, jointHalfPx: r3(t.halfWidth),
  bytes: Object.values(t.out).map(o => o.buf.length)})), textureBytes: texBytes,
  provenanceBytes: outputs.filter(o => o.path.startsWith(PROV_DIR_REL)).reduce((n, o) => n + o.buf.length, 0)}, null, 1));

if (CHECK) {
  const diff = [...outputs.filter(f => !fs.existsSync(path.join(PUB, f.path)) || !fs.readFileSync(path.join(PUB, f.path)).equals(f.buf)).map(f => f.path),
    ...(fs.existsSync(path.join(root, TS_REL)) && fs.readFileSync(path.join(root, TS_REL), 'utf8') === tsText ? [] : [TS_REL]),
    ...(fs.readFileSync(ALLOW, 'utf8') === allowText ? [] : ['tools/release/public-inputs.json'])];
  if (diff.length) fail(`out of date: ${diff.join(', ')}`);
  console.log('build-subway-arch-textures: public files match a fresh build');
  process.exit(0);
}
if (DRY) process.exit(0);
fs.mkdirSync(path.join(PUB, OUT_DIR_REL), {recursive: true});
for (const o of outputs) fs.writeFileSync(path.join(PUB, o.path), o.buf);
fs.writeFileSync(path.join(root, TS_REL), tsText);
fs.writeFileSync(ALLOW, allowText);
console.log('build-subway-arch-textures: wrote', outputs.length, 'public files,', TS_REL, 'tools/release/public-inputs.json');
