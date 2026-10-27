#!/usr/bin/env node
// Iteration 04 (Lane E): see-through rifle optic runtime derivative.
// Input:  game/public/assets/models/rifle.glb (iteration-01 runtime derivative; read only, never rewritten; masters untouched).
// Output: game/public/assets/models/rifle-optic.glb + game/public/assets/derivatives/rifle-optic-iteration04.json
//
// The AI-reconstructed rifle carries an ACOG-style scope whose lens caps were baked as opaque, textured surfaces
// (a closed cup at the objective, a closed disc at the eyepiece). This pass:
//   1. fits the scope tube axis from circle fits of mesh cross-sections (eyepiece half), constrained parallel to the
//      bore (model -Z) so the reticle line is the bore line;
//   2. cuts every AI triangle that reaches into a bore cylinder between the objective and eyepiece faces
//      (the opaque lens caps / cup and any interior surface), leaving the textured outer housing;
//   3. adds authored, textured optic parts on that axis: an inner tube wall (matte black, baffle rings), a front
//      objective retaining ring and a rear eyecup ring (both cover the cut edges), front + rear glass discs
//      (glTF BLEND glass; the game viewmodel swaps the rear glass for its ADS lens/reticle shader) and
//      OpticRear / OpticFront anchor empties. Muzzle/Grip anchors, AI vertices, UVs and textures are unchanged.
// Usage: node tools/asset-pipeline/props/rifle-optic-iteration04.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rel = f => path.relative(REPO, f);
const SRC = path.join(REPO, 'game/public/assets/models/rifle.glb');
const SRC_SHA = 'eb8b2f43f56629db2f95a1d2738be15a6922f7a4c368b9f04aa8fea402692623'; // derivatives/props.json outputs[rifle].sha256
const OUT = path.join(REPO, 'game/public/assets/models/rifle-optic.glb');
const PROV = path.join(REPO, 'game/public/assets/derivatives/rifle-optic-iteration04.json');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Parameters (metres, model space of rifle.glb: muzzle -Z, top +Y, origin bbox centre).
const K = {
  guess: [0.0105, 0.1435],            // eyeballed scope centre (front/rear views) used only to seed the fits
  fitBand: [0.014, 0.032],            // radial band (from the seed) of section points used for circle fits
  fitInlier: 0.002,                   // iterative outlier rejection (|r_i - r| > 2 mm dropped)
  axisSlicesZ: [0.03, 0.04, 0.05, 0.06, 0.066, 0.072, 0.078, 0.083], // eyepiece half: what the eye sees at ADS
  reportSlicesZ: [-0.047, -0.044, -0.04, -0.035, -0.03, -0.02, -0.01, 0, 0.01, 0.02],
  faceSearchR: 0.03,                  // vertices within this radius of the axis define the objective/eyepiece faces
  boreCut: 0.0202,                    // AI triangles reaching inside this radius (between the faces) are removed …
  keepOutwardDot: 0.35,               // … unless outward-facing housing facets (normal·radial > this) centred outside tubeR
  keepOutwardMinR: 0.0188,            //     that graze no deeper than this radius (0.92 × lens: the clear aperture stays empty)
  tubeR: 0.0205,                      // authored inner tube wall + glass radius
  tubeWall: 0.0006,                   // tube wall thickness (outer skin radius = tubeR + tubeWall)
  ringIn: 0.0197,                     // retaining-ring inner radius (slight lip over the glass edge)
  ringOutMin: 0.0235, ringOutMax: 0.0285, ringOutMargin: 0.0008,
  ringDepth: 0.003,                   // outer skirt depth of each ring
  ringProud: 0.0006,                  // rings sit this far proud of the AI faces
  rearRecess: 0.004,                  // rear glass behind the eyecup face
  frontRecess: 0.009,                 // objective glass behind the objective face (inside the AI sunshade cup)
  segments: 48,
  tex: 512,
};

const io = new NodeIO();
const srcBytes = fs.readFileSync(SRC);
if (sha(srcBytes) !== SRC_SHA) throw new Error(`rifle.glb sha256 mismatch: ${sha(srcBytes)}`);
const doc = await io.readBinary(new Uint8Array(srcBytes));
const root = doc.getRoot();
const rifleNode = root.listNodes().find(n => n.getName() === 'rifle');
const prim = rifleNode.getMesh().listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray();
const I = prim.getIndices().getArray();
const nV = P.length / 3, nT = I.length / 3;
const bakedMat = prim.getMaterial();

// ---------------------------------------------------------------------------------------------- 1. axis fit
function section(z0) {
  const pts = [];
  for (let f = 0; f < I.length; f += 3) for (let e = 0; e < 3; e++) {
    const a = I[f + e], b = I[f + (e + 1) % 3], za = P[3 * a + 2], zb = P[3 * b + 2];
    if ((za - z0) * (zb - z0) < 0) { const t = (z0 - za) / (zb - za); pts.push([P[3 * a] + (P[3 * b] - P[3 * a]) * t, P[3 * a + 1] + (P[3 * b + 1] - P[3 * a + 1]) * t]); }
  }
  return pts;
}
function kasa(pts) { // algebraic circle fit x^2+y^2+Dx+Ey+F=0
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of pts) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, pts.length]], b = [-Sxz, -Syz, -Sz];
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < 3; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const s = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < 3; c++) v -= A[i][c] * s[c]; s[i] = v / A[i][i]; }
  const cx = -s[0] / 2, cy = -s[1] / 2;
  return {cx, cy, r: Math.sqrt(cx * cx + cy * cy - s[2])};
}
function fitSlice(z0) {
  let pts = section(z0).filter(([x, y]) => { const r = Math.hypot(x - K.guess[0], y - K.guess[1]); return r > K.fitBand[0] && r < K.fitBand[1]; });
  let f = kasa(pts);
  for (let it = 0; it < 3; it++) { const keep = pts.filter(([x, y]) => Math.abs(Math.hypot(x - f.cx, y - f.cy) - f.r) < K.fitInlier); if (keep.length < 8) break; pts = keep; f = kasa(pts); }
  const rms = Math.sqrt(pts.reduce((s, [x, y]) => s + (Math.hypot(x - f.cx, y - f.cy) - f.r) ** 2, 0) / pts.length);
  return {z: z0, centre: [+f.cx.toFixed(5), +f.cy.toFixed(5)], radius: +f.r.toFixed(5), points: pts.length, rmsMm: +(rms * 1000).toFixed(2)};
}
const axisFits = K.axisSlicesZ.map(fitSlice);
const otherFits = K.reportSlicesZ.map(fitSlice);
const AX = axisFits.reduce((s, f) => s + f.centre[0], 0) / axisFits.length;
const AY = axisFits.reduce((s, f) => s + f.centre[1], 0) / axisFits.length;
// residual yaw of the AI tube vs the bore (least-squares slope of all fitted centres x(z)), reported, not applied
const allFits = [...otherFits, ...axisFits];
const mz = allFits.reduce((s, f) => s + f.z, 0) / allFits.length, mx = allFits.reduce((s, f) => s + f.centre[0], 0) / allFits.length, my = allFits.reduce((s, f) => s + f.centre[1], 0) / allFits.length;
const szz = allFits.reduce((s, f) => s + (f.z - mz) ** 2, 0);
const yawSlope = allFits.reduce((s, f) => s + (f.z - mz) * (f.centre[0] - mx), 0) / szz, pitchSlope = allFits.reduce((s, f) => s + (f.z - mz) * (f.centre[1] - my), 0) / szz;
const radial = i => Math.hypot(P[3 * i] - AX, P[3 * i + 1] - AY);

// faces of the scope along the axis
let zFront = Infinity, zRear = -Infinity;
for (let i = 0; i < nV; i++) {
  const z = P[3 * i + 2];
  if (z < -0.07 || z > 0.11 || P[3 * i + 1] < AY - 0.026 || radial(i) > K.faceSearchR) continue;
  zFront = Math.min(zFront, z); zRear = Math.max(zRear, z);
}

// ---------------------------------------------------------------------------------------------- 2. bore cut
const zCut0 = zFront - 0.003, zCut1 = zRear + 0.003;
const BARY = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3],
  [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3], [0.25, 0.75, 0], [0.75, 0.25, 0], [0, 0.25, 0.75], [0, 0.75, 0.25], [0.25, 0, 0.75], [0.75, 0, 0.25]];
// Outward-facing housing facets (vertex normals pointing away from the axis) whose centroid lies outside the tube
// wall are KEPT when a flat facet's chord only grazes the bore rim (never inside 0.92 x lens radius): removing them would open the outside of the scope,
// and from inside the bore they are back faces behind the tube wall. Everything else reaching into the bore — the
// ±Z lens caps, the objective cup, inner-wall intrusions, any facet centred inside the tube — is removed.
const removed = new Uint8Array(nT);
let nRemoved = 0, nKeptOutward = 0;
for (let t = 0; t < nT; t++) {
  const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
  let inside = false, minR = Infinity;
  for (const [wa, wb, wc] of BARY) {
    const x = wa * P[3 * a] + wb * P[3 * b] + wc * P[3 * c], y = wa * P[3 * a + 1] + wb * P[3 * b + 1] + wc * P[3 * c + 1], z = wa * P[3 * a + 2] + wb * P[3 * b + 2] + wc * P[3 * c + 2];
    if (z < zCut0 || z > zCut1) continue;
    const r = Math.hypot(x - AX, y - AY);
    minR = Math.min(minR, r);
    if (r < K.boreCut) inside = true;
  }
  if (!inside) continue;
  const cx = (P[3 * a] + P[3 * b] + P[3 * c]) / 3 - AX, cy = (P[3 * a + 1] + P[3 * b + 1] + P[3 * c + 1]) / 3 - AY, cl = Math.hypot(cx, cy) || 1;
  let nx = 0, ny = 0, nz = 0; for (const v of [a, b, c]) { nx += N[3 * v]; ny += N[3 * v + 1]; nz += N[3 * v + 2]; }
  const nl = Math.hypot(nx, ny, nz) || 1;
  if ((nx * cx + ny * cy) / cl / nl > K.keepOutwardDot && cl >= K.tubeR && minR >= K.keepOutwardMinR) { nKeptOutward++; continue; }
  removed[t] = 1; nRemoved++;
}
// new open boundary created by the cut: geometric edges shared by a removed and a kept triangle (positions quantised: UV seams split vertices)
const q = i => `${Math.round(P[3 * i] * 1e5)},${Math.round(P[3 * i + 1] * 1e5)},${Math.round(P[3 * i + 2] * 1e5)}`;
const edgeKey = (a, b) => { const ka = q(a), kb = q(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };
const edgeOwners = new Map();
for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) {
  const a = I[3 * t + e], b = I[3 * t + (e + 1) % 3], k = edgeKey(a, b);
  const o = edgeOwners.get(k) ?? {kept: 0, removed: 0, a, b}; if (removed[t]) o.removed++; else o.kept++; edgeOwners.set(k, o);
}
// grouped by where the open edge lies: objective end, eyepiece end (both must be covered by the rings) or the
// tube middle (holes in the AI housing's inner wall, hidden behind the authored tube wall)
const END = 0.012;
const boundary = Object.fromEntries(['front', 'middle', 'rear'].map(k => [k, {edges: 0, maxR: 0, minR: Infinity, zMin: Infinity, zMax: -Infinity}]));
const groupOf = z => z < zFront + END ? boundary.front : z > zRear - END ? boundary.rear : boundary.middle;
for (const o of edgeOwners.values()) {
  if (!(o.kept && o.removed)) continue;
  const g = groupOf((P[3 * o.a + 2] + P[3 * o.b + 2]) / 2);
  g.edges++;
  for (const v of [o.a, o.b]) {
    const z = P[3 * v + 2], r = radial(v);
    g.maxR = Math.max(g.maxR, r); g.minR = Math.min(g.minR, r); g.zMin = Math.min(g.zMin, z); g.zMax = Math.max(g.zMax, z);
  }
}
// compact the kept AI triangles (vertex attributes copied verbatim)
const remap = new Int32Array(nV).fill(-1);
const keptIdx = [];
let nKeptV = 0;
for (let t = 0; t < nT; t++) if (!removed[t]) for (let e = 0; e < 3; e++) { const v = I[3 * t + e]; if (remap[v] < 0) remap[v] = nKeptV++; keptIdx.push(remap[v]); }
const kP = new Float32Array(nKeptV * 3), kN = new Float32Array(nKeptV * 3), kUV = new Float32Array(nKeptV * 2);
for (let v = 0; v < nV; v++) { const r = remap[v]; if (r < 0) continue; kP.set(P.subarray(3 * v, 3 * v + 3), 3 * r); kN.set(N.subarray(3 * v, 3 * v + 3), 3 * r); kUV.set(UV.subarray(2 * v, 2 * v + 2), 2 * r); }

// ---------------------------------------------------------------------------------------------- 3. authored optic parts
const zRing = zRear + K.ringProud, zRingF = zFront - K.ringProud;
const zGlassRear = zRear - K.rearRecess, zGlassFront = zFront + K.frontRecess;
const clampR = r => Math.min(K.ringOutMax, Math.max(K.ringOutMin, r + K.ringOutMargin));
const rOutRear = clampR(boundary.rear.maxR), rOutFront = clampR(boundary.front.maxR);

class Builder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; this.parts = {}; }
  v(p, n, uv) { this.p.push(...p); this.n.push(...n); this.uv.push(...uv); return this.p.length / 3 - 1; }
  /** triangle wound so its geometric normal agrees with the vertex normals (front face = normal side) */
  tri(a, b, c) {
    const pa = this.p.slice(3 * a, 3 * a + 3), pb = this.p.slice(3 * b, 3 * b + 3), pc = this.p.slice(3 * c, 3 * c + 3);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nn = [0, 1, 2].map(k => this.n[3 * a + k] + this.n[3 * b + k] + this.n[3 * c + k]);
    if (g[0] * nn[0] + g[1] * nn[1] + g[2] * nn[2] >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  mark(name, t0) { this.parts[name] = (this.idx.length / 3) - t0; }
  get tris() { return this.idx.length / 3; }
}
const S = K.segments, ang = i => (i / S) * Math.PI * 2;
const at = (r, a, z) => [AX + r * Math.cos(a), AY + r * Math.sin(a), z];
// atlas: v 0.02-0.46 exterior worn finish (rings/skirts), v 0.54-0.98 interior matte black (tube)
function cylinder(B, r, z0, z1, inward, v0, v1, rings = 1) {
  const base = B.p.length / 3;
  for (let k = 0; k <= rings; k++) for (let i = 0; i <= S; i++) {
    const a = ang(i), z = z0 + (z1 - z0) * k / rings, s = inward ? -1 : 1;
    B.v(at(r, a, z), [s * Math.cos(a), s * Math.sin(a), 0], [i / S, v0 + (v1 - v0) * k / rings]);
  }
  for (let k = 0; k < rings; k++) for (let i = 0; i < S; i++) {
    const a = base + k * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
    B.tri(a, b, d); B.tri(a, d, c);
  }
}
function annulus(B, z, rIn, rOut, nz, v0, v1) {
  const base = B.p.length / 3;
  for (let i = 0; i <= S; i++) { const a = ang(i); B.v(at(rIn, a, z), [0, 0, nz], [i / S, v0]); B.v(at(rOut, a, z), [0, 0, nz], [i / S, v1]); }
  for (let i = 0; i < S; i++) { const a = base + 2 * i, b = a + 1, c = a + 2, d = a + 3; B.tri(a, b, d); B.tri(a, d, c); }
}
function disc(B, z, r, nz) { // lens-local UV: (0.5 + 0.5 x/r, 0.5 + 0.5 y/r)
  const c = B.v([AX, AY, z], [0, 0, nz], [0.5, 0.5]);
  const base = B.p.length / 3;
  for (let i = 0; i <= S; i++) { const a = ang(i); B.v(at(r, a, z), [0, 0, nz], [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); }
  for (let i = 0; i < S; i++) B.tri(c, base + i, base + i + 1);
}
const body = new Builder();
let t0 = body.tris; cylinder(body, K.tubeR, zRingF, zRing, true, 0.54, 0.98, 2); body.mark('innerTubeWall', t0);
// outer skin of the tube (a real wall thickness): wherever the AI housing has a gap at the bore (e.g. where the bell
// steps down on the side the AI tube is offset toward) this shows dark worn metal instead of the tube interior
t0 = body.tris; cylinder(body, K.tubeR + K.tubeWall, zRingF + K.ringDepth, zRing - K.ringDepth, false, 0.02, 0.46, 2); body.mark('outerTubeSkin', t0);
t0 = body.tris; annulus(body, zRing, K.ringIn, rOutRear, 1, 0.02, 0.3); cylinder(body, rOutRear, zRing - K.ringDepth, zRing, false, 0.3, 0.46); body.mark('rearEyecupRing', t0);
t0 = body.tris; annulus(body, zRingF, K.ringIn, rOutFront, -1, 0.02, 0.3); cylinder(body, rOutFront, zRingF, zRingF + K.ringDepth, false, 0.3, 0.46); body.mark('frontObjectiveRing', t0);
// ring inner lips between the ring face and the tube wall
t0 = body.tris; annulus(body, zRing - 0.0004, K.ringIn, K.tubeR + 0.0002, -1, 0.3, 0.32); annulus(body, zRingF + 0.0004, K.ringIn, K.tubeR + 0.0002, 1, 0.3, 0.32); body.mark('ringBackFaces', t0);
const glassRear = new Builder(); disc(glassRear, zGlassRear, K.tubeR, 1);
const glassFront = new Builder(); disc(glassFront, zGlassFront, K.tubeR, -1);

// ---------------------------------------------------------------------------------------------- textures (palette from the rifle's own optic texels)
async function rawImage(tex) { const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; }
const colorImg = await rawImage(bakedMat.getBaseColorTexture()), ormImg = await rawImage(bakedMat.getMetallicRoughnessTexture());
const px = (img, u, v) => { const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w))), y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h))), i = 3 * (y * img.w + x); return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const samples = [], ormSamples = [];
for (let i = 0; i < nV; i++) { const r = radial(i), z = P[3 * i + 2]; if (r < 0.022 || r > 0.034 || z < zFront || z > zRear) continue; samples.push(px(colorImg, UV[2 * i], UV[2 * i + 1])); ormSamples.push(px(ormImg, UV[2 * i], UV[2 * i + 1])); }
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
samples.sort((a, b) => lum(a) - lum(b));
const pct = p => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
const pal = {p10: pct(0.1), p50: pct(0.5), p90: pct(0.9)};
const med = arr => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
const roughness = +(med(ormSamples.map(c => c[1])) / 255).toFixed(3), metalness = +(med(ormSamples.map(c => c[2])) / 255).toFixed(3);

function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s, period) { // tileable in x with the given period (cells)
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash(((a % period) + period) % period, b, s);
  return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
}
const fbm = (x, y, s, per) => { let a = 0, w = 0.5, f = 1; for (let o = 0; o < 4; o++) { a += w * vnoise(x * f, y * f, s + o, per * f); w *= 0.5; f *= 2; } return a; };
const T = K.tex, texData = Buffer.alloc(T * T * 3);
for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
  const u = x / T, v = y / T, i = 3 * (y * T + x);
  let c;
  if (v < 0.5) { // exterior: worn dark anodised finish like the AI housing (grime fbm, circumferential brushing, edge wear speckle)
    const g = fbm(u * 16, v * 16, 11, 16), brush = vnoise(u * 256, v * 6, 23, 256), wear = fbm(u * 48, v * 48, 37, 48);
    const t = Math.min(1, Math.max(0, 0.15 + 0.55 * g + 0.18 * (brush - 0.5)));
    c = [0, 1, 2].map(k => pal.p10[k] + (pal.p50[k] - pal.p10[k]) * t * 1.6);
    if (wear > 0.68) { const wv = Math.min(1, (wear - 0.68) * 5); c = c.map((cv, k) => cv + (pal.p90[k] - cv) * wv * 0.7); }
  } else { // interior: matte black tube with faint baffle/thread rings along the length (v)
    const ring = 0.5 + 0.5 * Math.cos(v * Math.PI * 2 * 40), g = fbm(u * 24, v * 24, 51, 24);
    const t = 0.32 + 0.18 * g - 0.12 * ring * ring;
    c = [0, 1, 2].map(k => pal.p10[k] * t);
  }
  for (let k = 0; k < 3; k++) texData[i + k] = Math.max(0, Math.min(255, Math.round(c[k])));
}
const texJpeg = await sharp(texData, {raw: {width: T, height: T, channels: 3}}).jpeg({quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();

// ---------------------------------------------------------------------------------------------- assemble
const buffer = root.listBuffers()[0];
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
const idxArr = (arr, nverts) => nverts <= 65535 ? Uint16Array.from(arr) : Uint32Array.from(arr);
// AI mesh: replace the primitive's arrays with the compacted, cut copy (old accessors disposed so they are not written)
const oldAccessors = [prim.getAttribute('POSITION'), prim.getAttribute('NORMAL'), prim.getAttribute('TEXCOORD_0'), prim.getIndices()];
prim.setAttribute('POSITION', acc('VEC3', kP)).setAttribute('NORMAL', acc('VEC3', kN)).setAttribute('TEXCOORD_0', acc('VEC2', kUV)).setIndices(acc('SCALAR', idxArr(keptIdx, nKeptV)));
for (const a of oldAccessors) a.dispose();
const metalTex = doc.createTexture('rifle-optic-metal-color').setImage(new Uint8Array(texJpeg)).setMimeType('image/jpeg');
const metalMat = doc.createMaterial('rifle-optic-metal').setBaseColorTexture(metalTex).setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(metalness).setRoughnessFactor(roughness).setDoubleSided(false).setAlphaMode('OPAQUE');
const glassMat = doc.createMaterial('rifle-optic-glass').setBaseColorFactor([0.05, 0.075, 0.09, 0.32]).setMetallicFactor(0).setRoughnessFactor(0.06)
  .setDoubleSided(false).setAlphaMode('BLEND');
const meshOf = (name, B, mat) => doc.createMesh(name).addPrimitive(doc.createPrimitive()
  .setAttribute('POSITION', acc('VEC3', new Float32Array(B.p))).setAttribute('NORMAL', acc('VEC3', new Float32Array(B.n))).setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(B.uv)))
  .setIndices(acc('SCALAR', idxArr(B.idx, B.p.length / 3))).setMaterial(mat));
rifleNode.addChild(doc.createNode('OpticBody').setMesh(meshOf('rifle-optic-body', body, metalMat)));
rifleNode.addChild(doc.createNode('OpticGlassRear').setMesh(meshOf('rifle-optic-glass-rear', glassRear, glassMat)));
rifleNode.addChild(doc.createNode('OpticGlassFront').setMesh(meshOf('rifle-optic-glass-front', glassFront, glassMat)));
const r5 = x => +x.toFixed(5);
rifleNode.addChild(doc.createNode('OpticRear').setTranslation([r5(AX), r5(AY), r5(zGlassRear)]));
rifleNode.addChild(doc.createNode('OpticFront').setTranslation([r5(AX), r5(AY), r5(zGlassFront)]));
rifleNode.setExtras({optic: {axis: [r5(AX), r5(AY)], direction: [0, 0, -1], lensRadius: K.tubeR, rearGlassZ: r5(zGlassRear), frontGlassZ: r5(zGlassFront), provenance: 'derivatives/rifle-optic-iteration04.json'}});

const outBytes = Buffer.from(await io.writeBinary(doc));
fs.writeFileSync(OUT, outBytes);
if (sha(fs.readFileSync(SRC)) !== SRC_SHA) throw new Error('source changed during build');

// ---------------------------------------------------------------------------------------------- provenance
const countTris = d => d.getRoot().listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0), 0);
const check = await io.readBinary(new Uint8Array(outBytes));
const outTris = countTris(check);
const prov = {
  schema: 'last-line-derivative/1', asset: 'rifle-optic', key: 'rifle', task: 'studio-slice-iteration04-20261026-01', lane: 'E (see-through rifle optic + usable ADS)',
  status: 'prototype runtime derivative; source unapproved, gameReady false; not approved art; no commercial/model licence clearance asserted',
  rebuild: 'node tools/asset-pipeline/props/rifle-optic-iteration04.mjs   (QA renders: node tools/asset-pipeline/props/qa-rifle-optic-iteration04.mjs)',
  deterministic: 'Fixed parameters, no timestamps or randomness (hash noise); identical input + tool versions reproduce identical bytes.',
  source: {file: rel(SRC), sha256: SRC_SHA, sha256Verified: true, triangles: nT, vertices: nV, note: 'iteration-01 runtime derivative of assault-rifle-03 (see derivatives/props.json outputs[rifle]); read only — rifle.glb and every master are unchanged'},
  output: {file: rel(OUT), sha256: sha(outBytes), bytes: outBytes.length, triangles: outTris, primitives: {
    aiRifleCut: {triangles: keptIdx.length / 3, vertices: nKeptV, material: 'rifle-baked (unchanged textures)'},
    opticBody: {triangles: body.tris, vertices: body.p.length / 3, material: 'rifle-optic-metal', parts: body.parts},
    glassRear: {triangles: glassRear.tris, material: 'rifle-optic-glass (BLEND)'},
    glassFront: {triangles: glassFront.tris, material: 'rifle-optic-glass (BLEND)'},
  }},
  diagnosis: 'rifle.glb\'s ACOG-style scope is one closed, opaque AI surface: the objective is a textured cup closed ~1 cm inside the bell (z≈-0.04 m) and the eyepiece a closed textured disc (z≈+0.085 m); a ray along the scope axis hits opaque triangles at both ends. The iteration-01..03 ADS (aim [0,-0.283,-0.42]) therefore put the eye ~5 cm ABOVE the scope axis and sighted over the housing with the HUD crosshair.',
  method: [
    {step: 'axis fit', detail: 'Kasa circle fits of mesh cross-sections (points in a 14-32 mm band around a seed centre, 3 rounds of 2 mm outlier rejection). Axis = mean centre of the eyepiece-half slices, constrained parallel to the bore (model -Z) so the reticle line is the bore line.',
      axis: [r5(AX), r5(AY)], eyepieceSliceFits: axisFits, objectiveSliceFits: otherFits,
      aiTubeMisalignment: {yawDeg: +(Math.atan(yawSlope) * 180 / Math.PI).toFixed(2), pitchDeg: +(Math.atan(pitchSlope) * 180 / Math.PI).toFixed(2), note: 'measured slope of the AI housing centres vs z; not applied (the axis stays bore-parallel); the bore cut and tube cover the few-mm offset'}},
    {step: 'faces', detail: `min/max z of AI vertices within ${K.faceSearchR} m of the axis (scope only)`, objectiveFaceZ: r5(zFront), eyepieceFaceZ: r5(zRear)},
    {step: 'bore cut', detail: `removed every AI triangle with any of 16 barycentric samples inside r < ${K.boreCut} m of the axis and within z ∈ [objective face - 3 mm, eyepiece face + 3 mm], except outward-facing housing facets centred outside the tube wall (mean vertex normal · radial > ${K.keepOutwardDot}, centroid r ≥ ${K.tubeR} m and no sample deeper than r = ${K.keepOutwardMinR} m; they keep the outside closed and are back faces behind the tube wall from inside the bore); remaining vertices compacted, attributes copied verbatim`,
      trianglesRemoved: nRemoved, outwardHousingFacetsKept: nKeptOutward, verticesRemoved: nV - nKeptV,
      openBoundary: Object.fromEntries(Object.entries(boundary).map(([k, b]) => [k, {edges: b.edges, radiusRange: [r5(b.minR), r5(b.maxR)], zRange: [r5(b.zMin), r5(b.zMax)]}]))},
    {step: 'authored parts', detail: 'all on the fitted axis, 48 segments; triangle winding checked against normals',
      innerTubeWall: {radius: K.tubeR, z: [r5(zRingF), r5(zRing)], normals: 'inward', uv: 'atlas v 0.54-0.98 (matte black, baffle rings)'},
      outerTubeSkin: {radius: K.tubeR + K.tubeWall, z: [r5(zRingF + K.ringDepth), r5(zRing - K.ringDepth)], normals: 'outward', uv: 'atlas v 0.02-0.46 (worn exterior)', why: 'closes small gaps where the AI housing steps down near the offset side of the bore'},
      rearEyecupRing: {z: r5(zRing), radius: [K.ringIn, r5(rOutRear)], skirtDepth: K.ringDepth, covers: 'rear cut edge'},
      frontObjectiveRing: {z: r5(zRingF), radius: [K.ringIn, r5(rOutFront)], skirtDepth: K.ringDepth, covers: 'objective cut edge'},
      glassRear: {z: r5(zGlassRear), radius: K.tubeR, facing: '+Z (eye)', recess: K.rearRecess, uv: 'lens-local (0.5+0.5x/r, 0.5+0.5y/r)'},
      glassFront: {z: r5(zGlassFront), radius: K.tubeR, facing: '-Z (target)', recess: K.frontRecess},
      anchors: {OpticRear: [r5(AX), r5(AY), r5(zGlassRear)], OpticFront: [r5(AX), r5(AY), r5(zGlassFront)], Muzzle: 'unchanged', Grip: 'unchanged'}},
    {step: 'textures/materials', detail: 'rifle-optic-metal: 512² procedural JPEG (hash fbm grime, circumferential brushing, edge-wear speckle; interior half matte black with baffle rings) whose palette is sampled from the rifle\'s own baked optic-housing texels; metallic/roughness factors = medians of the rifle ORM texels on the housing. rifle-optic-glass: glTF BLEND, tinted, no texture (world/pickup view). rifle-baked textures untouched.',
      palette: pal, sampledTexels: samples.length, metallicFactor: metalness, roughnessFactor: roughness, texture: {size: [T, T], mime: 'image/jpeg', bytes: texJpeg.length}},
  ],
  runtime: 'game/src/weapons/optic.ts + viewmodel.ts: in the first-person viewmodel the rear glass becomes a depth-masked lens (the world pass shows through the full eyepiece, i.e. a 1x optic image), a collimated reticle (red dot + duplex) drawn by the lens shader at the aim direction, coating tint/sheen, edge vignette and an eye-box exit pupil (dark lens off-axis / at hip). ADS puts the eye on the axis at the configured eye relief behind OpticRear (weapons.ts rifle.view.optic). World pickups use the plain glTF glass.',
  limitations: [
    'The housing remains the AI reconstruction (inferred/blurred detail, mirrored markings); only the lens caps/interior were replaced.',
    'The AI scope tube is a few millimetres off the bore-parallel axis (see aiTubeMisalignment); the authored rings are centred on the axis, so the housing can look slightly eccentric around the eyecup up close.',
    'Optic is a 1x see-through presentation (no picture-in-picture magnification); the ADS camera FOV change is unchanged.',
    'Authored parts use a procedural texture tuned to the rifle palette, not a bake from the source model.',
  ],
};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log(JSON.stringify({axis: prov.method[0].axis, faces: [zFront, zRear], removed: nRemoved, boundary: prov.method[2].openBoundary, outTris, bytes: outBytes.length, parts: body.parts, palette: pal, metalness, roughness}, null, 1));
