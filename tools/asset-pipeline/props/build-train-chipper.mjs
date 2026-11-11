// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane ASSET): the runtime derivative of the train CHIPPER — the corpse woodchipper
// fixed inside the player's train (feeding dead bodies grinds them into fuel; world/chipperSpec.ts is the model / anchor contract) — from
// its Meshy T2.5 smart-topology image-to-3D original, conditioned on one Codex INITIAL design image (route Codex -> Meshy; the model
// keeps Meshy's own PBR maps, re-encoded only).
//
// Reads (never modifies) the immutable raw original + the fsynced job ledger kept OUTSIDE Git in
//   reference/tasks/corpse-chipper-fuel-20261110-235304/gen/{LEDGER.jsonl, MESHY-APPROVAL-ACK.json, PRODUCTION-INPUT-MANIFEST.json,
//   raw/<accepted raw>.glb, out/<conditioning image>.png}
// (verifies the accepted raw against the ledger's sha256 / bytes and the conditioning image against the reserved input sha) and writes
// deterministically:
//   game/public/assets/models/train-chipper.glb          (flat: tools/release/package-ci.mjs only allows assets/models/<name>.glb)
//   game/public/assets/derivatives/train-chipper.json    (provenance; hash-only: no prompts / URLs / tokens / private paths)
//   game/src/assets/trainChipper.generated.ts            (key / url / bytes / tris / dims / measured anchors: world/chipperSpec.ts reads it)
//   game/public/assets/CREDITS.md                        (the marked train-chipper section)
//   tools/release/public-inputs.json                     (ONLY this script's paths + CREDITS.md added / updated; others untouched)
//
// Derivative: Meshy's native frame KEPT — checked on the mesh, never assumed: +Y up (the base frame and its feet are the lowest broad layer),
// the open feed hopper at -X (the tall open-topped end; the twin collection tanks make the low +X end), so the conditioning side
// elevation (hopper left, rotor grille facing the viewer) is the +Z face. UNIFORM scale to the runtime length L_M (the car's bay
// pocket: <= 1.40 m long, <= 0.64 m deep, top below the ~0.98 m window sill), grounded (min y = 0) and centred on x / z, baked into the
// vertices (identity nodes). No geometry simplification: Smart Topology made the approved target count (18.3k triangles for a
// multi-part hero machine the player works at — the car's console is 11.4k, the shell 28.1k; one per car). The model's OWN Meshy PBR
// maps (base colour, packed metallic-roughness, normal) are kept channel for channel and re-encoded (Lanczos downsize, JPEG): no
// reprojection / retexture / repaint.
// Anchors (world/chipperSpec.ts ChipperAnchors) are MEASURED on the cooked triangles (see measureAnchors): the hopper mouth from a
// top-down height map, the outlet from a section of the discharge spout, the control panel from the front depth map.
//
// Usage: node tools/asset-pipeline/props/build-train-chipper.mjs [--dry-run]
//   (the private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-corpse-chipper-fuel-20261110-235304-01';
const TASK_DIR = 'reference/tasks/corpse-chipper-fuel-20261110-235304';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const GEN = path.join(REF_ROOT, TASK_DIR, 'gen');
const ID = 'train-chipper';
const OUT_REL = `assets/models/${ID}.glb`;
const PROV_REL = `assets/derivatives/${ID}.json`;
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/trainChipper.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN train-chipper-model (build-train-chipper.mjs) -->';
const CREDITS_END = '<!-- END train-chipper-model -->';
const CREDITS_AFTER = '<!-- END train-fuel-and-airtank-models -->';
const DRY = process.argv.includes('--dry-run');
/** Runtime length along X (m): the car's bay pocket takes <= 1.40 m; uniform scale gives ~0.83 m tall, ~0.62 m deep. */
const L_M = 1.36;
const LIMIT = {l: 1.40, h: 0.90, d: 0.64};
/** Texture policy (px, JPEG quality): base colour / normal carry the hard-surface detail the player sees up close; the packed
 *  metallic-roughness is low-frequency. Comparable train fixtures: the lockbox / console 1024 / 512 / 256 q85, the fuel can 1024 q85. */
const TEX = {base: 1024, normal: 1024, mr: 512, quality: 85, normalQuality: 90};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { throw new Error(`build-train-chipper: ${m}`); };
const r4 = v => +v.toFixed(4), r3 = v => +v.toFixed(3);

// ---------------------------------------------------------------------------------------------
// Records: the ledger's single accept is the authority

const ledger = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.asset === 'CHIPPER');
const accepts = ledger.filter(e => e.type === 'accept');
if (accepts.length !== 1) fail(`expected exactly one CHIPPER accept in the ledger, found ${accepts.length}`);
const accept = accepts[0], RES = accept.res;
const one = type => { const l = ledger.filter(e => e.type === type && e.res === RES); if (l.length !== 1) fail(`${RES}: expected one '${type}' line, found ${l.length}`); return l[0]; };
const reserve = one('reserve'), posted = one('posted'), settle = one('settle'), raw = one('raw');
if (settle.status !== 'SUCCEEDED') fail(`${RES}: settle status ${settle.status}`);
const approvalAck = JSON.parse(fs.readFileSync(path.join(GEN, 'MESHY-APPROVAL-ACK.json'), 'utf8'));
if (reserve.approvalSha256 !== approvalAck.approvalSha256) fail('reserve line approval sha differs from the approval acknowledgement');
const billedAll = ledger.filter(e => e.type === 'settle').reduce((s, e) => s + (e.billed ?? 0), 0);
const attempts = ledger.filter(e => e.type === 'reserve').length;
if (billedAll > approvalAck.caps.credits || attempts > approvalAck.caps.attempts) fail(`ledger outside the approval caps: ${billedAll} credits / ${attempts} attempts`);
const rel = (abs, sub) => { const base = path.basename(abs); if (!abs.endsWith(`${TASK_DIR}/gen/${sub}/${base}`)) fail(`unexpected ledger path ${abs}`); return `gen/${sub}/${base}`; };
const RAW_REL = rel(raw.file, 'raw');
const rawBytes = fs.readFileSync(path.join(REF_ROOT, TASK_DIR, RAW_REL));
if (sha(rawBytes) !== raw.sha256 || rawBytes.length !== raw.bytes) fail(`raw sha / size mismatch: ${RAW_REL}`);
const CODEX_REL = rel(reserve.input, 'out');
const codexBytes = fs.readFileSync(path.join(REF_ROOT, TASK_DIR, CODEX_REL));
if (sha(codexBytes) !== reserve.inputSha256 || reserve.inputSha256 !== reserve.approvedSourceSha256) fail('conditioning image sha mismatch');
const prodManifest = JSON.parse(fs.readFileSync(path.join(GEN, 'PRODUCTION-INPUT-MANIFEST.json'), 'utf8'));
const prodAsset = prodManifest.assets.find(a => a.id === 'CHIPPER');
if (prodAsset?.sourceImageSha256 !== reserve.inputSha256) fail('production input manifest does not bind the conditioning image');
const codexMeta = await sharp(codexBytes).metadata();

// ---------------------------------------------------------------------------------------------
// Geometry helpers (one primitive after flatten; positions in the frame being measured)

const tris = d => d.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
/** Every triangle as [[x,y,z] x 3] (all meshes / primitives; node transforms are identity after flatten + clear). */
function triangleList(d) {
  const out = [];
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION').getArray(), I = p.getIndices()?.getArray() ?? Uint32Array.from({length: P.length / 3}, (_, i) => i);
    for (let t = 0; t < I.length; t += 3) out.push([0, 1, 2].map(k => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]]));
  }
  return out;
}
/**
 * A height / depth map: cells over axes (a, c) of size res inside box `win` ({min, max} on all 3 axes); each cell keeps the extreme
 * (sign +1 max / -1 min) of axis v over the triangles covering the cell centre (only triangle parts inside win along v count).
 */
function extremeMap(T, a, c, v, sign, res, win) {
  const nA = Math.max(1, Math.ceil((win.max[a] - win.min[a]) / res)), nC = Math.max(1, Math.ceil((win.max[c] - win.min[c]) / res));
  const m = new Float64Array(nA * nC).fill(NaN);
  for (const p of T) {
    const A = p.map(q => (q[a] - win.min[a]) / res - 0.5), C = p.map(q => (q[c] - win.min[c]) / res - 0.5);
    const i0 = Math.max(0, Math.ceil(Math.min(...A))), i1 = Math.min(nA - 1, Math.floor(Math.max(...A)));
    const j0 = Math.max(0, Math.ceil(Math.min(...C))), j1 = Math.min(nC - 1, Math.floor(Math.max(...C)));
    if (i0 > i1 || j0 > j1) continue;
    const d = (A[1] - A[0]) * (C[2] - C[0]) - (A[2] - A[0]) * (C[1] - C[0]);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const w1 = ((i - A[0]) * (C[2] - C[0]) - (A[2] - A[0]) * (j - C[0])) / d, w2 = ((A[1] - A[0]) * (j - C[0]) - (i - A[0]) * (C[1] - C[0])) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
      const val = w0 * p[0][v] + w1 * p[1][v] + w2 * p[2][v];
      if (val < win.min[v] || val > win.max[v]) continue;
      const k = i * nC + j;
      if (Number.isNaN(m[k]) || (sign > 0 ? val > m[k] : val < m[k])) m[k] = val;
    }
  }
  const at = (i, j) => m[i * nC + j];
  const cA = i => win.min[a] + (i + 0.5) * res, cC = j => win.min[c] + (j + 0.5) * res;
  return {m, nA, nC, at, cA, cC};
}

// ---------------------------------------------------------------------------------------------
// Orientation checks (raw frame, before scaling): +Y up, the open hopper at -X

function orientation(T, b) {
  const ext = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  // the base frame: geometry within 3 % of the height above the lowest point spans most of the footprint
  const low = T.flat().filter(q => q[1] < b.min[1] + 0.03 * ext[1]);
  const span = k => (Math.max(...low.map(q => q[k])) - Math.min(...low.map(q => q[k]))) / ext[k];
  const baseSpanX = span(0), baseSpanZ = span(2);
  // end slabs (12 % of the length): the hopper end is tall (its rim near the top), the tank end low
  const slabTop = (x0, x1) => Math.max(...T.flat().filter(q => q[0] >= x0 && q[0] <= x1).map(q => q[1]));
  const negEnd = (slabTop(b.min[0], b.min[0] + 0.12 * ext[0]) - b.min[1]) / ext[1];
  const posEnd = (slabTop(b.max[0] - 0.12 * ext[0], b.max[0]) - b.min[1]) / ext[1];
  const res = {upAxis: 'y', baseSpanX: r3(baseSpanX), baseSpanZ: r3(baseSpanZ), negXEndTop: r3(negEnd), posXEndTop: r3(posEnd)};
  if (!(baseSpanX > 0.75 && baseSpanZ > 0.6)) fail(`not +Y up? base layer spans ${JSON.stringify(res)}`);
  if (!(negEnd > 0.8 && posEnd < 0.65)) fail(`hopper not at -X? end slab tops ${JSON.stringify(res)}`);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Anchors (cooked frame, metres)

/** Mean of the finite values. */
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

function measureAnchors(T, b) {
  const L = b.max[0] - b.min[0];
  const RES = 0.005;
  // --- HOPPER: the open feed box at -X: a floor, tall end walls, low side lips, and a top frame (the end walls + two rails across the
  // box; the rubber flap curtain hangs from the front rail). Mouth = the box's inner rectangle (where its floor is seen from above);
  // the anchor = its centre at the rim (top frame) height.
  const top = extremeMap(T, 0, 2, 1, 1, RES, {min: [b.min[0], b.min[1], b.min[2]], max: [b.min[0] + 0.40 * L, b.max[1], b.max[2]]});
  const cells = [];
  for (let i = 0; i < top.nA; i++) for (let j = 0; j < top.nC; j++) { const v = top.at(i, j); if (Number.isFinite(v)) cells.push(v); }
  const bins = new Map();
  for (const v of cells) { const k = Math.floor(v / 0.01); bins.set(k, (bins.get(k) ?? 0) + 1); }
  const bandMean = k => mean(cells.filter(v => v >= k * 0.01 && v < (k + 1) * 0.01));
  // the box FLOOR: the most populated 1 cm band seen from above; the RIM (top frame: end walls + the rails across the box): the
  // highest 1 cm band holding >= 4 % of the covered cells (thin posts / hinge knobs above it are ignored)
  const floorBin = [...bins].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
  const rimBin = Math.max(...[...bins].filter(([, n]) => n >= 0.04 * cells.length).map(([k]) => k));
  const floorY = bandMean(floorBin), rimY = bandMean(rimBin);
  if (!(rimY - floorY > 0.2)) fail(`hopper: rim ${rimY} not well above the floor ${floorY}`);
  // open = the floor is what you see from above (within 3 cm of the floor band)
  const open = (i, j) => { const v = top.at(i, j); return Number.isFinite(v) && Math.abs(v - floorY) <= 0.03; };
  // inner faces of the end walls: walk along the slab's centre line z = 0 (between the rails) from the slab's middle to the first
  // non-open cell each way
  const jc = Math.min(top.nC - 1, Math.max(0, Math.round((0 - top.cC(0)) / RES))), im = Math.floor(top.nA / 2);
  if (!open(im, jc)) fail('hopper: the slab middle on the centre line does not see the box floor');
  let ia = im, ib = im;
  while (ia > 0 && open(ia - 1, jc)) ia--;
  while (ib < top.nA - 1 && open(ib + 1, jc)) ib++;
  if (ia === 0 || ib === top.nA - 1) fail('hopper: an end wall is missing along the centre line');
  // inner faces of the side lips: the z extent of every open cell between the end walls (the rails / flap curtain overhead split the
  // floor into strips; each strip still sees the floor)
  let ja = jc, jb = jc;
  for (let i = ia; i <= ib; i++) for (let j = 0; j < top.nC; j++) if (open(i, j)) { ja = Math.min(ja, j); jb = Math.max(jb, j); }
  const mouth = {x0: top.cA(ia) - RES / 2, x1: top.cA(ib) + RES / 2, z0: top.cC(ja) - RES / 2, z1: top.cC(jb) + RES / 2};
  // the side lips' height (informational): the highest top just outside the open z range, along the box's middle
  const lipAt = j => { const v = []; for (let i = ia; i <= ib; i++) { const t = top.at(i, j); if (Number.isFinite(t)) v.push(t); } return v.length ? Math.max(...v) : NaN; };
  const lipOf = js => Math.max(...js.filter(j => j >= 0 && j < top.nC).map(lipAt).filter(Number.isFinite));
  const lipY = Math.min(lipOf([ja - 1, ja - 2, ja - 3]), lipOf([jb + 1, jb + 2, jb + 3]));
  const hopper = {x: r3((mouth.x0 + mouth.x1) / 2), y: r3(rimY), z: r3((mouth.z0 + mouth.z1) / 2)};
  const hopperMouth = {x: r3(mouth.x1 - mouth.x0), z: r3(mouth.z1 - mouth.z0)};

  // --- OUTLET: the discharge spout leaves the rotor housing's +X side along the machine's middle plane, under the control box, and
  // carries the hose to the tanks. March section planes x = const outward from the housing; at each station the section's segments
  // inside the spout lane (OUT_WIN, runtime frame) are grouped into connected pieces (endpoints within 5 mm) and the largest piece is
  // taken (a stray control-cable cut is its own piece). The spout ROOT is the first station where that piece is a closed, round ring
  // no wider than OUT_RING (past the rotor housing / flange plates); the outlet = that ring's centre.
  // (the lane stops under the control box's support plate, y ~0.48)
  const OUT_WIN = {x0: 0.10, x1: 0.45, y0: 0.20, y1: 0.46, z0: -0.10, z1: 0.10}, OUT_RING = 0.15, OUT_STEP = 0.0025, JOIN = 0.005;
  const inWin = (y, z) => y >= OUT_WIN.y0 && y <= OUT_WIN.y1 && z >= OUT_WIN.z0 && z <= OUT_WIN.z1;
  const sectionAt = X => {
    const segs = [];
    for (const p of T) {
      const q = [];
      for (let e = 0; e < 3; e++) {
        const u = p[e], w = p[(e + 1) % 3];
        if ((u[0] - X) * (w[0] - X) >= 0) continue;
        const s = (X - u[0]) / (w[0] - u[0]);
        q.push([u[1] + s * (w[1] - u[1]), u[2] + s * (w[2] - u[2])]);
      }
      if (q.length === 2 && inWin(...q[0]) && inWin(...q[1])) segs.push(q);
    }
    // union-find over segments sharing an endpoint (within JOIN)
    const parent = segs.map((_, i) => i);
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const ends = segs.flatMap((s, i) => [[s[0], i], [s[1], i]]).sort((a, c) => a[0][0] - c[0][0]);
    for (let a = 0; a < ends.length; a++) for (let c = a + 1; c < ends.length && ends[c][0][0] - ends[a][0][0] <= JOIN; c++)
      if (Math.abs(ends[c][0][1] - ends[a][0][1]) <= JOIN) parent[find(ends[a][1])] = find(ends[c][1]);
    const groups = new Map();
    segs.forEach((s, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); });
    return [...groups.values()].sort((a, c) => c.length - a.length)[0] ?? [];
  };
  let outlet = null, ring = null;
  for (let X = OUT_WIN.x0; X <= OUT_WIN.x1 + 1e-9 && !outlet; X += OUT_STEP) {
    const piece = sectionAt(X);
    if (piece.length < 12) continue;
    const pts = piece.flat(), ys = pts.map(q => q[0]), zs = pts.map(q => q[1]);
    const ey = Math.max(...ys) - Math.min(...ys), ez = Math.max(...zs) - Math.min(...zs);
    if (ey > OUT_RING || ez > OUT_RING || ey < 0.04 || ez < 0.04 || Math.abs(ey - ez) > 0.04) continue;
    // closed: every piece endpoint meets another (a cut tube's outline is a loop) and it surrounds its centre on all four sides
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const open = pts.filter(a => pts.filter(c => Math.abs(c[0] - a[0]) <= JOIN && Math.abs(c[1] - a[1]) <= JOIN).length < 2).length;
    const quads = new Set(pts.map(([y, z]) => Math.abs(y - cy) > Math.abs(z - cz) ? (y > cy ? 'u' : 'd') : (z > cz ? 'f' : 'b')));
    if (open > 0 || quads.size < 4) continue;
    outlet = {x: r3(X), y: r3(cy), z: r3(cz)};
    ring = {diameterY: r3(ey), diameterZ: r3(ez), segments: piece.length};
  }
  if (!outlet) fail('outlet: no spout ring found in the spout lane');

  // --- PANEL: the control box's front face (red stop button, lever). In the search window PANEL_WIN (beside the belt guard, under the
  // motor; runtime frame) the front depth map's most common 1 cm depth band is the box face; the anchor = the centre of that plateau's
  // largest connected patch, on the face plane.
  const PANEL_WIN = {x0: 0.10, x1: 0.34, y0: 0.42, y1: 0.68};
  const PRES = 0.005;
  const front = extremeMap(T, 0, 1, 2, 1, PRES, {min: [PANEL_WIN.x0, PANEL_WIN.y0, 0], max: [PANEL_WIN.x1, PANEL_WIN.y1, b.max[2]]});
  const dBins = new Map();
  for (let i = 0; i < front.nA; i++) for (let j = 0; j < front.nC; j++) { const v = front.at(i, j); if (Number.isFinite(v)) { const k = Math.floor(v / 0.01); dBins.set(k, (dBins.get(k) ?? 0) + 1); } }
  const faceBin = [...dBins].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0];
  const onFace = (i, j) => { const v = front.at(i, j); return Number.isFinite(v) && Math.abs(v - (faceBin + 0.5) * 0.01) <= 0.01; };
  const seen = new Uint8Array(front.nA * front.nC);
  let best = null;
  for (let i0 = 0; i0 < front.nA; i0++) for (let j0 = 0; j0 < front.nC; j0++) {
    if (seen[i0 * front.nC + j0] || !onFace(i0, j0)) continue;
    const st = [[i0, j0]], patch = [];
    seen[i0 * front.nC + j0] = 1;
    while (st.length) {
      const [i, j] = st.pop(); patch.push([i, j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= front.nA || c >= front.nC || seen[a * front.nC + c] || !onFace(a, c)) continue;
        seen[a * front.nC + c] = 1; st.push([a, c]);
      }
    }
    if (!best || patch.length > best.length) best = patch;
  }
  const pi = best.map(q => q[0]), pj = best.map(q => q[1]);
  const face = {x0: front.cA(Math.min(...pi)) - PRES / 2, x1: front.cA(Math.max(...pi)) + PRES / 2, y0: front.cC(Math.min(...pj)) - PRES / 2, y1: front.cC(Math.max(...pj)) + PRES / 2};
  const faceZ = mean(best.map(([i, j]) => front.at(i, j)));
  if (best.length * PRES * PRES < 0.006) fail(`panel: face patch too small (${best.length} cells)`);
  const panel = {x: r3((face.x0 + face.x1) / 2), y: r3((face.y0 + face.y1) / 2), z: r3(faceZ)};

  return {
    anchors: {hopper, hopperMouth, outlet, panel},
    measured: {
      hopper: {floorY: r3(floorY), rimY: r3(rimY), lipY: r3(lipY), inner: {x0: r3(mouth.x0), x1: r3(mouth.x1), z0: r3(mouth.z0), z1: r3(mouth.z1)}},
      outlet: {ring},
      panel: {face: {x0: r3(face.x0), x1: r3(face.x1), y0: r3(face.y0), y1: r3(face.y1)}, faceZ: r3(faceZ)},
    },
    method: {
      hopper: 'top-down height map (5 mm) of the -X 40 % slab: floor = its most populated 1 cm band, rim = the highest band holding >= 4 % of the cells (the end walls + the top rails across the box); inner X = the end walls\' inner faces along the centre line z = 0, inner Z = the extent of every cell between them that sees the floor; anchor = the inner rectangle\'s centre at the rim height',
      outlet: `section planes x = const every ${OUT_STEP * 1000} mm from x ${OUT_WIN.x0} m inside the spout lane y ${OUT_WIN.y0}..${OUT_WIN.y1}, z ${OUT_WIN.z0}..${OUT_WIN.z1} m: the first one cut as a single closed ring <= ${OUT_RING} m across (past the rotor housing / flange plates) = the spout root; anchor = the ring centre`,
      panel: `front depth map (5 mm) in x ${PANEL_WIN.x0}..${PANEL_WIN.x1}, y ${PANEL_WIN.y0}..${PANEL_WIN.y1} m: the most common 1 cm depth band = the control box face; anchor = its largest connected patch's centre on the face plane (mean depth)`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Cook

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(new Uint8Array(rawBytes));
const r = doc.getRoot();
const rawTris = tris(doc);
const rawTex = r.listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
await doc.transform(flatten());
for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
const scene = r.getDefaultScene() ?? r.listScenes()[0];
const b0 = getBounds(scene);
const ext = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
const orient = orientation(triangleList(doc), b0);
const s = L_M / ext[0];
const M = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * (b0.min[0] + b0.max[0]) / 2, -s * b0.min[1], -s * (b0.min[2] + b0.max[2]) / 2, 1]; // column-major
for (const m of r.listMeshes()) transformMesh(m, M);
r.listMeshes().forEach((m, i) => m.setName(i ? `${ID}-${i}` : ID));
r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${ID}-${i}` : ID));
r.listMaterials().forEach((m, i) => m.setName(i ? `${ID}-${i}` : ID));
await doc.transform(dedup(), prune(),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.base, TEX.base], quality: TEX.quality, slots: /^baseColor/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.mr, TEX.mr], quality: TEX.quality, slots: /^metallicRoughness/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.normal, TEX.normal], quality: TEX.normalQuality, slots: /^normal/}));
r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-train-chipper.mjs (glTF-Transform)';
const glb = Buffer.from(await io.writeBinary(doc));
const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) fail('URL/token-like string inside the glTF JSON');

const chk = await io.readBinary(new Uint8Array(glb));
const cr = chk.getRoot();
const b1 = getBounds(cr.getDefaultScene() ?? cr.listScenes()[0]);
const dims = [0, 1, 2].map(k => r4(b1.max[k] - b1.min[k]));
if (Math.abs(b1.min[1]) > 1e-4 || Math.abs(b1.min[0] + b1.max[0]) > 2e-3 || Math.abs(b1.min[2] + b1.max[2]) > 2e-3) fail(`not grounded / centred: ${JSON.stringify(b1)}`);
if (Math.abs(dims[0] - L_M) > 1e-3 || dims[0] > LIMIT.l || dims[1] > LIMIT.h || dims[2] > LIMIT.d) fail(`size outside the car pocket: ${dims}`);
const mats = cr.listMaterials();
if (mats.length !== 1 || !mats[0].getBaseColorTexture() || !mats[0].getMetallicRoughnessTexture() || !mats[0].getNormalTexture()) fail('expected one material with base colour, metallic-roughness and normal maps');
const textures = cr.listTextures().map(t => {
  const slot = mats.flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
  return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
});
const outTris = tris(chk);
const measure = measureAnchors(triangleList(chk), b1);
const A = measure.anchors;
const inside = p => p.x > b1.min[0] && p.x < b1.max[0] && p.y > b1.min[1] && p.y < b1.max[1] + 1e-6 && p.z > b1.min[2] && p.z < b1.max[2];
if (![A.hopper, A.outlet, A.panel].every(inside)) fail(`anchor outside the bounds: ${JSON.stringify(A)}`);
if (!(A.hopper.x < 0 && A.outlet.x > A.hopper.x && A.panel.z > 0)) fail(`anchors not where the frame puts them: ${JSON.stringify(A)}`);
if (!(A.hopperMouth.x > 0.25 && A.hopperMouth.z > 0.25 && A.hopper.x - A.hopperMouth.x / 2 > b1.min[0])) fail(`hopper mouth implausible: ${JSON.stringify(A)}`);

console.log(`${ID}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(3)} MB (${outTris} tris), dims ${dims.join(' x ')} m, scale ${s.toFixed(5)}`);
console.log(textures.map(t => `  ${t.slot} ${t.size?.join('x')} ${t.mime} ${t.bytes} B`).join('\n'));
console.log('orientation', JSON.stringify(orient));
console.log('anchors', JSON.stringify(A));
console.log('measured', JSON.stringify(measure.measured));
if (DRY) process.exit(0);

// ---------------------------------------------------------------------------------------------
// Write: model, provenance, generated module, CREDITS section, allowlist

fs.writeFileSync(path.join(PUB, OUT_REL), glb);
const meshyRequest = (({file_path: _f, ...rest}) => rest)(reserve.params);
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: ID,
  what: 'the train CHIPPER: a compact electric corpse woodchipper bolted inside the player train (feed hopper with a flap curtain, guarded rotor housing with an inspection grille, motor + belt guard, control box with stop button and lever, discharge spout + hose, twin collection tanks, welded base frame)',
  task: TASK,
  approval: `task-specific user generation approval (sha256 ${reserve.approvalSha256}): one woodchipper model and supported processing, up to ${approvalAck.caps.credits} Meshy credits / ${approvalAck.caps.attempts} generation attempts`,
  accepted: true,
  route: 'Codex native image_gen INITIAL design / conditioning image (flat side elevation) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); the Meshy model keeps its own PBR maps (re-encoded only)',
  conditioningImage: {sha256: reserve.inputSha256, bytes: codexBytes.length, size: `${codexMeta.width}x${codexMeta.height}`, generator: 'Codex CLI 0.163.0 built-in image_gen (model id not reported)', file: `${TASK_DIR}/${CODEX_REL} (raw original, outside Git)`},
  meshy: {
    tool: `${reserve.tool} (@meshy-ai/meshy-mcp-server ${approvalAck.mcp.version})`,
    request: meshyRequest,
    task: posted.taskId, status: settle.status, billedCredits: settle.billed,
    budget: {attempts, billedTotal: billedAll, caps: approvalAck.caps},
    evidence: 'the exact create arguments are in the fsynced ledger reserve line before the POST; the 15-credit charge is the T2 / T2.5 single-image textured price',
  },
  source: {file: `${TASK_DIR}/${RAW_REL} (raw original, outside Git)`, sha256: raw.sha256, bytes: raw.bytes, triangles: rawTris, extent: ext.map(r4), textures: rawTex},
  output: {file: `game/public/${OUT_REL}`, url: OUT_REL, sha256: sha(glb), bytes: glb.length, triangles: outTris, dims},
  lengthM: L_M, scale: +s.toFixed(6),
  orientation: {...orient, result: 'Meshy native frame kept (no rotation): +Y up, hopper -X, so the conditioning side elevation is the +Z face'},
  transform: 'uniform scale to the runtime length, grounded (min y = 0), centred on x / z, baked into the vertices (identity node); no rotation, no geometry simplification (Smart Topology made the approved target count)',
  convention: 'metres at runtime size, +Y up, origin at the bottom centre of the base frame; +Z = the front (rotor housing inspection grille, control box face), -X = the feed hopper end, +X = the twin collection tanks',
  anchors: A, measured: measure.measured, anchorMethod: measure.method,
  texturePolicy: `Meshy maps kept channel for channel (base colour, packed metallic-roughness, normal), Lanczos downsize + JPEG: base ${TEX.base} px q${TEX.quality}, metallic-roughness ${TEX.mr} px q${TEX.quality}, normal ${TEX.normal} px q${TEX.normalQuality}; no reprojection / retexture / repaint`,
  textures,
  licence: 'generated for this project under the existing provider accounts; no blanket licence or commercial clearance implied (assets/CREDITS.md)',
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces\/|\/home\/).{0,20}/i); if (hit) fail(`URL / token / local path in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);

const lit = o => JSON.stringify(o).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1: ').replace(/,/g, ', ').replace(/"/g, '\'');
const tex = Object.fromEntries(textures.map(t => [t.slot, t.size]));
const M_ = measure.measured;
const reg = `// GENERATED by tools/asset-pipeline/props/build-train-chipper.mjs — do not edit (task ${TASK}).
// The train CHIPPER's runtime model: a Meshy T2.5 image-to-3D derivative of one Codex design image, its own PBR maps kept (provenance
// ${PROV_REL}). world/chipperSpec.ts reads this.
// Model frame (metres at runtime size): origin at the bottom centre of the base frame, +Y up, +Z = the front (rotor housing inspection
// grille, control box face), -X = the feed hopper end, +X = the twin collection tanks. One mesh, one material, identity node.
export const TRAIN_CHIPPER = {
  key: '${ID}', url: '${OUT_REL}', bytes: ${glb.length}, tris: ${outTris}, dims: [${dims.join(', ')}] as const,
  textures: {baseColor: [${tex.baseColor.join(', ')}] as const, metallicRoughness: [${tex.metallicRoughness.join(', ')}] as const, normal: [${tex.normal.join(', ')}] as const},
} as const;

/** Runtime size (m): length along X, height, depth along Z (the cooked bounds). */
export const TRAIN_CHIPPER_SIZE = {l: ${dims[0]}, h: ${dims[1]}, d: ${dims[2]}} as const;

/** Anchors measured on the cooked mesh (model frame, m; the methods are in the provenance's anchorMethod). */
export const TRAIN_CHIPPER_ANCHORS = {
  /** Centre of the hopper box's inner rectangle at the rim (top frame) height. */
  hopper: ${lit(A.hopper)},
  /** The hopper box's inner size (between the end walls along X, between the side lips along Z). */
  hopperMouth: ${lit(A.hopperMouth)},
  /** The discharge spout's root (where the hose run leaves the rotor housing): the spout ring's centre. */
  outlet: ${lit(A.outlet)},
  /** The control box face's centre (stop button + lever), on the face plane. */
  panel: ${lit(A.panel)},
} as const;

/**
 * Supporting measurements. Hopper: its floor, the low side lips (front / back, the box is open above them under the top frame), the
 * rim = the top frame (end-wall peaks and two rails across the box; the rubber flap curtain hangs from the front rail) and the inner
 * rectangle. Outlet: the spout ring's diameters. Panel: the control box face rectangle and its plane.
 */
export const TRAIN_CHIPPER_MEASURED = {
  hopper: ${lit(M_.hopper)},
  outlet: ${lit({diameterY: M_.outlet.ring.diameterY, diameterZ: M_.outlet.ring.diameterZ})},
  panel: ${lit(M_.panel)},
} as const;
`;
fs.writeFileSync(REG, reg);

const credSection = [CREDITS_BEGIN, '## Train chipper', '',
  `Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (re-encoded only). Task ${TASK} under the user's chipper authorization (${billedAll} of up to ${approvalAck.caps.credits} credits, ${attempts} attempt${attempts === 1 ? '' : 's'}). AI-generated asset: unapproved prototype, no licence or commercial clearance implied. The raw master, conditioning image and job ledger are kept outside Git.`, '',
  `- \`${OUT_REL}\` — the train's corpse woodchipper (feed hopper, rotor housing, motor, control box, spout and hose, twin collection tanks on a welded base frame) (Meshy task ${posted.taskId}); runtime derivative by \`tools/asset-pipeline/props/build-train-chipper.mjs\` (provenance: \`${PROV_REL}\`).`,
  CREDITS_END].join('\n');
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
if (!credRe.test(credSrc) && !credSrc.includes(CREDITS_AFTER)) fail('CREDITS.md: neither the chipper section nor the train fuel section marker found');
fs.writeFileSync(CREDITS, credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : credSrc.replace(CREDITS_AFTER, `${CREDITS_AFTER}\n\n${credSection}`));

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([OUT_REL, PROV_REL, 'assets/CREDITS.md'].map(p => [p, fs.readFileSync(path.join(PUB, p))]));
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${OUT_REL}, ${PROV_REL}, ${path.relative(root, REG)}, assets/CREDITS.md, tools/release/public-inputs.json`);
