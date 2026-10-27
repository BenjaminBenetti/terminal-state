#!/usr/bin/env node
// The Last Line - iteration02 runtime derivatives for the two NEW generated prop masters (turnstile, supply crate).
// Usage: node tools/asset-pipeline/props/build-props-iteration02.mjs [--only turnstile,crate] [--inspect]
// Reads (read-only) the native F16 SV masters in reference/tasks/vertical-slice-iteration02-20261025/generation/<asset>/native/
// (sha256-verified against the controller receipt) and writes ONLY game/public/assets/models/{turnstile,crate}.glb and
// game/public/assets/derivatives/props-iteration02.json. Does not touch props.json or the older derivatives.
// Prototype, unapproved, gameReady false. Same simplify/unwrap/bake/encode chain as build-props.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDense, simplifyGeometry, sha256File, sha256Buf} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake} from './lib/bake.mjs';
import {encodeImage, writeMeshGlb} from './lib/glb.mjs';
import {det3, transformPositions, bbox} from './lib/orient.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GEN = path.join(REPO, 'reference/tasks/vertical-slice-iteration02-20261025/generation');
const OUT = {models: path.join(REPO, 'game/public/assets/models'), derivatives: path.join(REPO, 'game/public/assets/derivatives')};
const OWNED = [path.join(OUT.models, 'turnstile.glb'), path.join(OUT.models, 'crate.glb'), path.join(OUT.derivatives, 'props-iteration02.json')];
function guardedWrite(file, bytes) {
  const abs = path.resolve(file);
  if (!OWNED.includes(abs)) throw new Error(`refusing to write a file this script does not own: ${abs}`);
  fs.writeFileSync(abs, bytes);
  return {path: path.relative(REPO, abs), bytes: bytes.length, sha256: sha256Buf(bytes)};
}
const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const inspect = args.includes('--inspect');
const log = (...a) => console.log(...a);
const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 1e4) / 1e4, vec = a => a.map(r6);

// axisMap rows give output x,y,z in terms of source x,y,z (set from orientation evidence; see orientationEvidence).
const ASSETS = [
  {
    key: 'turnstile', out: 'turnstile.glb', asset: 'turnstile',
    // long cabinet axis -> Z; +Z = the card-reader end, which faced the conditioning camera (source -Z) and image right (source -X)
    pickFront: (hz, P) => { const L = extentAlong(P, hz[0]) > extentAlong(P, hz[1]) ? hz[0] : hz[1]; return (-L[0] - L[2]) >= 0 ? L : L.map(x => -x); },
    orientationEvidence: 'Native SV mesh keeps the elevated conditioning-camera pose (22.7 deg tilt from source +Y). Levelled via the dominant box-face frame; long cabinet axis -> Z with the card-reader end (image right, nearest the camera) at +Z; X = Y x Z (no mirror). Render check: qa-artifacts/assets/props-iteration02/turnstile-derived.png shows a level cabinet, reader on top at +Z, three arms on -X with one horizontal.',
    target: {axis: 1, meters: 1.02, label: 'height'}, tris: 6000, atlas: 1024, origin: 'bottom-center',
  },
  {
    key: 'crate', out: 'crate.glb', asset: 'supply-crate',
    // front (+Z) = the hasp/stencil face, i.e. the horizontal frame axis most facing the conditioning camera (source -Z)
    pickFront: (hz) => { const c = hz.map(h => -h[2]); const i = Math.abs(c[0]) >= Math.abs(c[1]) ? 0 : 1; return c[i] >= 0 ? hz[i] : hz[i].map(x => -x); },
    orientationEvidence: 'Native SV mesh keeps the elevated conditioning-camera pose. Levelled via the dominant box-face frame; front (+Z) = the box face most facing the conditioning camera (hasp + cream stencil panel); X = Y x Z (no mirror).',
    target: {axis: 0, meters: 0.62, label: 'width'}, tris: 4000, atlas: 1024, origin: 'bottom-center',
  },
];

// Single-view reconstructions keep the conditioning camera pose (elevated 3/4 view), so the object is pitched/yawed in
// source space. Recover the box frame from the dominant planar face normals (area-weighted mode finding), then pick
// up = frame axis closest to source +Y. Deterministic.
function boxFrame(P, I) {
  const nf = I.length / 3, step = Math.max(1, Math.floor(nf / 60000)), N = [], A = [];
  for (let f = 0; f < nf; f += step) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 0) { N.push([nx / l, ny / l, nz / l]); A.push(l / 2); }
  }
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // axis (sign-free) score: area within ~8 deg of +/-d
  const score = d => { let s = 0; for (let i = 0; i < N.length; i++) { const c = Math.abs(dot(N[i], d)); if (c > 0.99) s += A[i]; } return s; };
  const refine = d => { for (let it = 0; it < 4; it++) { const m = [0, 0, 0]; for (let i = 0; i < N.length; i++) { const c = dot(N[i], d); if (Math.abs(c) > 0.985) { const sg = Math.sign(c); for (let k = 0; k < 3; k++) m[k] += sg * A[i] * N[i][k]; } } d = norm(m); } return d; };
  const cands = []; const K = 1500;
  for (let i = 0; i < K; i++) { const y = 1 - (i + 0.5) / K, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5)); if (y >= 0) cands.push([r * Math.cos(t), y, r * Math.sin(t)]); }
  let d1 = refine(cands.reduce((b, d) => { const s = score(d); return s > b.s ? {s, d} : b; }, {s: -1}).d);
  let d2 = refine(cands.filter(d => Math.abs(dot(d, d1)) < 0.15).reduce((b, d) => { const s = score(d); return s > b.s ? {s, d} : b; }, {s: -1}).d);
  d2 = norm(d2.map((x, k) => x - dot(d2, d1) * d1[k]));
  const d3 = cross(d1, d2);
  const axes = [d1, d2, d3].map(d => ({d, s: score(d)}));
  let upI = 0; axes.forEach((a, i) => { if (Math.abs(a.d[1]) > Math.abs(axes[upI].d[1])) upI = i; });
  const up = axes[upI].d[1] < 0 ? axes[upI].d.map(x => -x) : axes[upI].d;
  const hz = axes.filter((_, i) => i !== upI).map(a => a.d);
  return {up, horizontal: hz, axisScores: axes.map(a => a.s), tiltFromSourceYDeg: Math.acos(Math.min(1, up[1])) * 180 / Math.PI, cross, dot};
}
// Build rows [X;Y;Z] with Y=up, Z=chosen front (horizontal frame axis), X = Y x Z (right-handed, det +1).
function levelRotation(P, I, pickFront) {
  const fr = boxFrame(P, I);
  const Z0 = pickFront(fr.horizontal, P);
  const Y = fr.up, Z = fr.cross(fr.cross(Y, Z0), Y).map((x, _, a) => x / Math.hypot(...a));
  const X = fr.cross(Y, Z);
  return {R: [X, Y, Z], frame: {up: vec(Y), front: vec(Z), right: vec(X), tiltFromSourceYDeg: r4(fr.tiltFromSourceYDeg), axisScores: fr.axisScores.map(r6)}};
}
const extentAlong = (P, d) => { let mn = Infinity, mx = -Infinity; for (let i = 0; i < P.length; i += 3) { const v = P[i] * d[0] + P[i + 1] * d[1] + P[i + 2] * d[2]; if (v < mn) mn = v; if (v > mx) mx = v; } return mx - mn; };

function verifiedSource(asset) {
  const dir = path.join(GEN, asset, 'native');
  const rc = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  if (!rc.ok) throw new Error(`${asset}: native receipt not ok`);
  const file = path.join(dir, 'asset.glb');
  const sha = sha256File(file);
  if (sha !== rc.artifacts['asset.glb'].sha256) throw new Error(`${asset}: sha256 mismatch`);
  const img = JSON.parse(fs.readFileSync(path.join(GEN, asset, 'image', 'receipt.json'), 'utf8'));
  return {file, rel: path.relative(REPO, file), sha256: sha, bytes: fs.statSync(file).size, jobId: rc.job_id, receipt: path.relative(REPO, path.join(dir, 'receipt.json')),
    conditioningImage: {path: path.relative(REPO, img.output.path), sha256: img.output.sha256, generator: img.generator, generatorModel: img.generatorModel}};
}

// Horizontal slice profile of the front (+Z) surface: per height bin, the 90th-percentile z of points in side bands
// (|x| between 18% and 40% of the half-width from the centre, avoiding the central latch and the corner guards).
function frontProfile(P, bins = 200) {
  const bb = bbox(P), H = bb.size[1], hw = bb.size[0] / 2, cx = bb.center[0];
  const cols = Array.from({length: bins}, () => []);
  for (let i = 0; i < P.length; i += 3) {
    const ax = Math.abs(P[i] - cx) / hw;
    if (ax < 0.36 || ax > 0.8) continue;
    const b = Math.min(bins - 1, Math.floor((P[i + 1] - bb.min[1]) / H * bins));
    cols[b].push(P[i + 2]);
  }
  return cols.map((c, b) => { c.sort((x, y) => x - y); return {y: bb.min[1] + (b + 0.5) / bins * H, zFront: c.length ? c[Math.floor(c.length * 0.9)] : NaN, n: c.length}; });
}

async function buildMesh(cfg) {
  const t0 = Date.now();
  const src = verifiedSource(cfg.asset);
  log(`\n== ${cfg.key} <- ${src.rel} (job ${src.jobId}, sha256 verified)`);
  const dense = await loadDense(src.file);
  const lev = levelRotation(dense.P, dense.I, cfg.pickFront);
  const R = lev.R, d = 0, yawDeg = 0;
  const det = det3(R);
  log('  level frame', JSON.stringify(lev.frame), 'det', det.toFixed(4));
  const bbR0 = bbox(transformPositions(dense.P, R));
  const sDense = cfg.target.meters / bbR0.size[cfg.target.axis];
  const tDense = [-bbR0.center[0] * sDense, -bbR0.min[1] * sDense, -bbR0.center[2] * sDense];
  const DP = transformPositions(dense.P, R, sDense, tDense);
  if (inspect) {
    const b = bbox(DP);
    log('  dense', dense.stats, 'minAreaYaw', d, 'output-space bbox size (m)', vec(b.size));
    return null;
  }
  const simp = await simplifyGeometry(dense, cfg.tris);
  log(`  simplified ${dense.stats.triangles} -> ${simp.idx.length / 3} tris`);
  const pad = 4;
  const low = unwrap(simp.pos, simp.idx, {atlas: cfg.atlas, pad});
  const searchRadius = Math.max(0.02, 6 * simp.errorAbsolute);
  const baked = await bake(dense, low, {atlas: cfg.atlas, supersample: 2, mrDiv: 2, normalDiv: 2, searchRadius, log: s => log('   ', s)});
  const bbR = bbox(transformPositions(low.pos, R));
  const s = cfg.target.meters / bbR.size[cfg.target.axis];
  const bbS = bbox(transformPositions(low.pos, R, s));
  const t = [-bbS.center[0], -bbS.min[1], -bbS.center[2]];
  const pos = transformPositions(low.pos, R, s, t);
  const nrm = transformPositions(low.nrm, R);
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  const idx = Uint32Array.from(low.idx);
  if (det < 0) for (let f = 0; f < idx.length; f += 3) { const tmp = idx[f + 1]; idx[f + 1] = idx[f + 2]; idx[f + 2] = tmp; }
  const outBB = bbox(pos);
  const extrasExtra = {};
  let measurements = null;
  if (cfg.key === 'crate') measurements = cfg.measure?.(transformPositions(dense.P, R, s, t), outBB) ?? null;
  if (cfg.key === 'turnstile') measurements = cfg.measure?.(transformPositions(dense.P, R, s, t), outBB) ?? null;
  if (measurements?.extras) Object.assign(extrasExtra, measurements.extras);
  const color = await encodeImage(baked.color.data, baked.color.size, baked.color.size, 'color');
  const orm = await encodeImage(baked.mr.data, baked.mr.size, baked.mr.size, 'orm');
  const normal = await encodeImage(baked.normal.data, baked.normal.size, baked.normal.size, 'normal');
  const status = 'prototype runtime derivative of an unapproved AI-reconstructed master (iteration02 native F16 SV); reviewStatus unapproved; gameReady false; no license clearance';
  const glb = await writeMeshGlb({
    name: cfg.key, mesh: {pos, nrm, uv: low.uv, idx}, textures: {color, orm, normal}, material: dense.material, children: [],
    extras: {sourceId: `iteration02-${cfg.asset}`, nativeJobId: src.jobId, sourceSha256: src.sha256, units: 'meters', provisionalDimensionsMeters: vec(outBB.size), status, pipeline: 'tools/asset-pipeline/props/build-props-iteration02.mjs', ...extrasExtra},
  });
  const written = guardedWrite(path.join(OUT.models, cfg.out), glb);
  log(`  wrote ${written.path} ${written.bytes} bytes, ${idx.length / 3} tris, size ${vec(outBB.size)} m (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return {
    output: written.path, key: cfg.key, kind: 'prop', bytes: written.bytes, sha256: written.sha256, triangles: idx.length / 3, vertices: pos.length / 3,
    textures: {baseColor: {size: [baked.color.size, baked.color.size], mime: color.mime, bytes: color.bytes.length}, metallicRoughness: {size: [baked.mr.size, baked.mr.size], mime: orm.mime, bytes: orm.bytes.length}, normal: {size: [baked.normal.size, baked.normal.size], mime: normal.mime, bytes: normal.bytes.length}},
    source: {asset: cfg.asset, path: src.rel, sha256: src.sha256, sha256Verified: true, bytes: src.bytes, nativeJobId: src.jobId, nativeReceipt: src.receipt, generationMode: 'local native F16 SV 1024, 24 steps/flow, seed 42, GSS 10, FoV 20', conditioningImage: src.conditioningImage, reviewStatus: 'unapproved', gameReady: false, triangles: dense.stats.triangles, vertices: dense.stats.vertices, textures: dense.material.textures},
    transform: {description: 'p_out = scale * R * p_source + translation (baked into vertices; node transform identity). R rows = output X,Y,Z axes in source coordinates, from the levelled box frame.', levelFrame: lev.frame, R: R.map(r => r.map(r6)), determinant: Math.round(det), mirrored: det < 0, scale: r6(s), translation: vec(t), orientationEvidence: cfg.orientationEvidence, origin: 'bottom centre (y=0 floor contact; x/z bbox centre)'},
    dimensionsMeters: {provisional: true, chosen: `${cfg.target.label} ${cfg.target.meters} m (uniform scale)`, bbox: {min: vec(outBB.min), max: vec(outBB.max), size: vec(outBB.size)}},
    conventions: {units: 'meters', front: '+Z', up: '+Y', origin: 'bottom-center'},
    measurements: measurements ? (({extras, ...m}) => m)(measurements) : null,
    pipeline: [
      {step: 'verify-source', detail: 'sha256 vs native controller receipt (reference/tasks/vertical-slice-iteration02-20261025/generation/<asset>/native/receipt.json)'},
      {step: 'simplify', tool: 'meshoptimizer (Permissive, weld by position)', targetTriangles: cfg.tris, resultTriangles: idx.length / 3, errorMeters: r6(simp.errorAbsolute * s)},
      {step: 'unwrap', tool: 'lib/unwrap.mjs', atlas: cfg.atlas, charts: low.stats.charts},
      {step: 'bake', tool: 'lib/bake.mjs (closest same-facing dense surface; colour, metallic-roughness, tangent normal)', supersample: 2, searchRadiusSourceUnits: r6(searchRadius)},
      {step: 'level+orient', detail: 'box frame from area-weighted dominant face normals (undoes the single-view camera pitch/yaw), up = frame axis nearest source +Y, front chosen per asset (orientationEvidence); uniform scale + bottom-centre origin baked into vertices'},
      {step: 'encode', detail: 'baseColor JPEG, metallicRoughness JPEG, normal PNG; plain glTF 2.0 binary, no extensions'},
    ],
    limitations: [
      'Single-view AI reconstruction: back/underside/hidden surfaces and texture are inferred, not designed.',
      `Simplified from ${dense.stats.triangles} to ${idx.length / 3} triangles; thin parts lose geometric detail; fine relief approximated by the baked normal map.`,
      'Provisional real-world scale chosen by this pipeline, not measured or approved.',
      'Prototype derivative: unapproved, gameReady false; no commercial/model license clearance asserted.',
      ...(cfg.limitations ?? []),
    ],
  };
}

// ---- per-asset measurements (output space, meters) --------------------------------------------------------------
ASSETS[0].measure = (DP, outBB) => {
  // Cabinet footprint = points below 0.30 m (under the lowest arm); arms = points outside the cabinet x-range.
  const cab = {min: [Infinity, Infinity], max: [-Infinity, -Infinity]};
  for (let i = 0; i < DP.length; i += 3) if (DP[i + 1] < 0.3) { cab.min[0] = Math.min(cab.min[0], DP[i]); cab.max[0] = Math.max(cab.max[0], DP[i]); cab.min[1] = Math.min(cab.min[1], DP[i + 2]); cab.max[1] = Math.max(cab.max[1], DP[i + 2]); }
  const arm = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity, n: 0}, armP = {minX: Infinity, maxX: -Infinity, n: 0};
  let hubY = 0, hubN = 0;
  for (let i = 0; i < DP.length; i += 3) {
    const x = DP[i], y = DP[i + 1], z = DP[i + 2];
    if (x < cab.min[0] - 0.02) { arm.n++; arm.minX = Math.min(arm.minX, x); arm.maxX = Math.max(arm.maxX, x); arm.minY = Math.min(arm.minY, y); arm.maxY = Math.max(arm.maxY, y); arm.minZ = Math.min(arm.minZ, z); arm.maxZ = Math.max(arm.maxZ, z); if (x < arm.minX + 0.05) { hubY += y; hubN++; } }
    if (x > cab.max[0] + 0.02) { armP.n++; armP.minX = Math.min(armP.minX, x); armP.maxX = Math.max(armP.maxX, x); }
  }
  // horizontal-arm height: mean y of the outermost 5 cm of the arms
  let tipY = 0, tipN = 0, tipZ = 0; for (let i = 0; i < DP.length; i += 3) if (DP[i] < arm.minX + 0.05) { tipY += DP[i + 1]; tipZ += DP[i + 2]; tipN++; }
  return {
    armsProtrudeToward: arm.n > armP.n ? '-X' : '+X',
    cabinetFootprintMeters: {x: [r4(cab.min[0]), r4(cab.max[0])], z: [r4(cab.min[1]), r4(cab.max[1])], width: r4(cab.max[0] - cab.min[0]), length: r4(cab.max[1] - cab.min[1])},
    arms: {pointsMinusX: arm.n, pointsPlusX: armP.n, reachX: r4(arm.minX), reachBeyondCabinetMeters: r4(cab.min[0] - arm.minX), yRange: [r4(arm.minY), r4(arm.maxY)], zRange: [r4(arm.minZ), r4(arm.maxZ)], horizontalArmTip: {x: r4(arm.minX), y: tipN ? r4(tipY / tipN) : null, z: tipN ? r4(tipZ / tipN) : null}},
    layout: 'Cabinet long axis = local Z (walking direction); +Z end carries the card reader (entry end in the conditioning image). Arms + rotor hub on the -X side of the cabinet; the horizontal arm blocks the lane on -X. Bbox centre (origin) is offset from the cabinet centre toward -X by the arm reach.',
    method: 'Output-space dense vertices: cabinet footprint from vertices below 0.30 m; arms = vertices >2 cm outside the cabinet x-range.',
  };
};

ASSETS[1].measure = (DP, outBB) => {
  // Lid seam from the dense surface (output space): per 2 mm height bin, the outermost surface depth of the front face
  // (side bands 0.12-0.24 m from centre, away from the central hasp and the corner guards) and of both side faces
  // (bands 0.10-0.17 m from centre in z, away from the handle). The seam is a groove: the deepest local minimum of the
  // combined profile between 70% and 92% of the height (above the handles, below the lid's top bevel).
  const H = outBB.size[1], zF = outBB.max[2], xR = outBB.max[0], xL = outBB.min[0], bin = 0.002, nb = Math.ceil(H / bin);
  const F = Array.from({length: nb}, () => -Infinity), S1 = F.slice(), S2 = F.slice();
  for (let i = 0; i < DP.length; i += 3) {
    const x = DP[i], y = DP[i + 1], z = DP[i + 2], b = Math.min(nb - 1, Math.floor(y / bin));
    if (Math.abs(x) > 0.12 && Math.abs(x) < 0.24 && z > zF - 0.08) F[b] = Math.max(F[b], z - zF);
    if (Math.abs(z) > 0.10 && Math.abs(z) < 0.17 && x > xR - 0.08) S1[b] = Math.max(S1[b], x - xR);
    if (Math.abs(z) > 0.10 && Math.abs(z) < 0.17 && x < xL + 0.08) S2[b] = Math.max(S2[b], xL - x);
  }
  const prof = F.map((f, b) => ({y: (b + 0.5) * bin, f, s1: S1[b], s2: S2[b], m: (f + S1[b] + S2[b]) / 3}));
  if (process.env.DEBUG_PROFILE) for (const p of prof.filter(p => p.y > 0.6 * H)) log(p.y.toFixed(3), p.f.toFixed(4), p.s1.toFixed(4), p.s2.toFixed(4));
  let best = null;
  for (let b = 0; b < nb; b++) {
    const p = prof[b]; if (p.y < 0.70 * H || p.y > 0.92 * H || !Number.isFinite(p.m)) continue;
    const nbh = prof.slice(Math.max(0, b - 8), b + 9).filter(q => Number.isFinite(q.m)).map(q => q.m).sort((a, c) => a - c);
    const dip = nbh[nbh.length - 2] - p.m; // relative to the near-maximum of the +-16 mm neighbourhood
    if (!best || dip > best.dip) best = {y: p.y, dip, f: p.f, s1: p.s1, s2: p.s2};
  }
  const lidSplitY = best ? r4(best.y) : null;
  return {lidSplitY, lidSplitFraction: lidSplitY != null ? r4(lidSplitY / H) : null, lidHeightMeters: lidSplitY != null ? r4(H - lidSplitY) : null,
    seamGrooveDepthMeters: best ? r4(best.dip) : null, seamDepthsAtSplit: best ? {front: r4(best.f), right: r4(best.s1), left: r4(best.s2)} : null,
    method: 'Dense output-space surface; 2 mm height bins; outermost depth of the front face (|x| 0.12-0.24 m) and both side faces (|z| 0.10-0.17 m), averaged; lid seam = deepest groove between 70% and 92% of the height. Visual cross-check: front ortho render (qa-artifacts/assets/props-iteration02/supply-crate-derived.png).',
    hingeEdge: 'back (-Z) top edge: the reconstruction shows two hinge-like plates on the back face just below the lid (inferred back; the conditioning image only showed the front/left)',
    extras: {lidSplitY}};
};

const t0 = Date.now();
const manifestPath = path.join(OUT.derivatives, 'props-iteration02.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const outputs = [];
for (const cfg of ASSETS) {
  if (only && !only.includes(cfg.key)) { const prev = previous?.outputs?.find(o => o.key === cfg.key); if (prev) outputs.push(prev); continue; }
  const r = await buildMesh(cfg);
  if (r) outputs.push(r);
}
if (!inspect) {
  const manifest = {
    schema: 'last-line-props-derivatives-v1', task: 'studio-slice-iteration02-20261025-01',
    status: 'PROTOTYPE runtime derivatives of two NEW iteration02 native F16 SV masters (turnstile, supply crate). Unapproved, gameReady false, not production art, no license clearance asserted. Dimensions provisional.',
    rebuild: 'node tools/asset-pipeline/props/build-props-iteration02.mjs',
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: 'bottom-centre (y=0 floor contact)', files: 'plain glTF 2.0 binary, no extensions'},
    outputs,
    note: 'Native masters stay in reference/tasks/vertical-slice-iteration02-20261025/generation/<asset>/native/ and are never copied to game/public. props.json (older derivatives) is not modified by this script.',
  };
  guardedWrite(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  log(`\nwrote ${path.relative(REPO, manifestPath)} (${((Date.now() - t0) / 1000).toFixed(1)} s total)`);
}
