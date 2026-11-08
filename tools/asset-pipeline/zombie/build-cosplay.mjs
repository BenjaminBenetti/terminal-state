#!/usr/bin/env node
// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY) — the CONVENTION COSPLAY wardrobe: costume pieces for the ordinary
// zombies of the Skyways anime convention, built ONLY from approved models already in this repository (no generation, no Meshy, no
// Codex, no hand-drawn texture). CPU only, deterministic, no network.
//   node tools/asset-pipeline/zombie/build-cosplay.mjs            build and write
//        game/public/assets/models/outfit-cosplay-head.glb    head slot: the convention mascot's bear-ear hat + blue wig, its alternate
//                                                             palette (cream hat + rose wig), the oversized mascot head (kigurumi-style
//                                                             costume head) and the nigiri-sushi mascot hat — rigid to the Head joint
//        game/public/assets/models/outfit-cosplay-upper.glb   upper slot: dyed copies of the fitted hoodie / sweater / blazer
//        game/public/assets/models/outfit-cosplay-lower.glb   lower slot: dyed copies of the fitted slacks
//        game/public/assets/derivatives/outfit-cosplay.json   provenance, method, fit stats, bytes / sha256
//        game/src/ai/cosplay.generated.ts                     runtime table (model keys, urls, bytes, wearables, fitted bodies)
//   --check   rebuild in a temp dir and require every output to be byte-identical to the committed one
//   dev only: --out=DIR (write there instead), --no-gate (ship every fit regardless of the poke gate: QA renders only)
// Sources (all shipped, approved runtime derivatives; read-only):
//  - assets/models/skyways-mascot-poses.glb node `stand` (the convention's original mascot statue; its PBR maps kept, re-encoded):
//    deterministic SPLIT by base colour + connectivity into (a) the bear-ear hat + its appliqués and the blue hair = a costume WIG/HAT and
//    (b) that plus the face above the neck = an oversized costume HEAD; simplified (meshoptimizer), then fitted rigidly per body;
//  - assets/models/skyways-sushi-mascot.glb (the ramen counter's nigiri mascot figurine; its map kept) = a novelty hat, fitted rigidly;
//  - assets/models/outfit-{hoodie,sweater,blazer,slacks}-t25.glb: the ordinary fitted garments' geometry / skin weights / masks copied
//    UNCHANGED; only their base-colour map is DYED (a deterministic per-texel luminance-preserving colour transform of the approved map);
//  - assets/models/zombie-body-<id>-t25.glb: the bodies (bind mesh, joints, geometry hash) the pieces are fitted to.
// Fit (rigid head pieces): body head measured by lib/headwear.mjs measureHead on the runtime bind mesh; a uniform scale + translation per
// body searched to keep the eyes clear and minimise body vertices poking through the piece (ray tests, lib/penetration.mjs TriGrid);
// body triangles whose outward ray meets the piece (or lying inside the costume head) are hidden (hideBodyTriangles); a body whose best
// fit still pokes beyond the gate gets no variant (the look library then never builds that pair).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {JOINTS} from './lib/skeleton.mjs';
import {measureHead} from './lib/headwear.mjs';
import {TriGrid} from './lib/penetration.mjs';
import {bitsetBase64, quantizeWeights} from './lib/variant-glb.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ARGS = new Set(process.argv.slice(2).filter(a => !a.includes('=')));
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const GENERATOR = 'Terminal State cosplay builder (tools/asset-pipeline/zombie/build-cosplay.mjs)';
const TASK = 'studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY)';
const MODELS = 'game/public/assets/models';
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const r4 = v => +(+v).toFixed(4);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const HEAD = JOINTS.findIndex(j => j[0] === 'Head');
const NECK = JOINTS.findIndex(j => j[0] === 'Neck');
const STATUS = {approved: false, gameReady: false, stage: 'unapproved prototype derivative (convention cosplay variants of the ordinary zombie); fit / deformation not certified',
  licenseClearance: 'none - inherits each source model\'s status (the mascot / sushi figurine: community-supplied sources via the user, no licence or authorship claim; the garments: Meshy-generated prototype derivatives)'};

/** Bodies the pieces are tried on (the scavenger's built-in mask fills its head / face slots: never). */
const BODY_IDS = ['lastshift', 'courier', 'agent', 'heavyset', 'tall', 'paleGaze', 'paleRevenant', 'paleApparition'];
const bodyFile = id => path.join(MODELS, `zombie-body-${id.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}-t25.glb`);

/** Dyes (target sRGB colour of the garment's median texel; luminance detail kept). */
export const DYES = {
  cocoa: {label: 'cocoa brown', rgb: [104, 66, 46]},
  salmon: {label: 'salmon orange', rgb: [226, 116, 82]},
  cream: {label: 'cream', rgb: [226, 214, 192]},
  navy: {label: 'navy', rgb: [44, 52, 86]},
  maroon: {label: 'maroon (the mascot\'s skirt)', rgb: [104, 40, 46]},
  rice: {label: 'rice white', rgb: [222, 220, 210]},
};
/** The dyed garments: [cosplay wearable id, base ordinary wearable, dye, label]. */
const GARMENTS = {
  upper: [['cosplay-hoodie-cocoa', 'hoodie', 'cocoa', 'Cocoa-brown mascot-suit hoodie'], ['cosplay-hoodie-salmon', 'hoodie', 'salmon', 'Salmon-orange hoodie'],
    ['cosplay-sweater-cream', 'sweater', 'cream', 'Cream knit top'], ['cosplay-blazer-navy', 'blazer', 'navy', 'Navy uniform blazer']],
  lower: [['cosplay-slacks-maroon', 'slacks', 'maroon', 'Maroon trousers'], ['cosplay-slacks-rice', 'slacks', 'rice', 'Rice-white trousers']],
};
/** The head pieces. */
const HEADS = [
  {id: 'cosplay-bearhat', piece: 'wig', palette: 'blue', label: 'Mascot cosplay: bear-ear hat + blue wig'},
  {id: 'cosplay-bearhat-rose', piece: 'wig', palette: 'rose', label: 'Mascot cosplay (alternate palette): cream bear-ear hat + rose wig'},
  {id: 'cosplay-mascot-head', piece: 'head', palette: 'blue', label: 'Oversized mascot costume head'},
  {id: 'cosplay-sushi-hat', piece: 'sushi', palette: 'sushi', label: 'Nigiri-sushi mascot hat'},
];
/**
 * The COSTUMES (the source of truth of ai/cosplay.ts via cosplay.generated.ts): one piece per slot; `slacks` = the ordinary grey slacks
 * (a uniform's trousers). A costume ships on every body where all its pieces are fitted (and the upper / lower layering is allowed).
 */
export const COSTUMES = [
  {id: 'bear-idol', label: 'Mascot cosplay: bear-ear hat, blue wig, cream knit top, maroon trousers', head: 'cosplay-bearhat', upper: 'cosplay-sweater-cream', lower: 'cosplay-slacks-maroon'},
  {id: 'mascot-suit', label: 'Mascot costume: oversized mascot head, cocoa hoodie, maroon trousers', head: 'cosplay-mascot-head', upper: 'cosplay-hoodie-cocoa', lower: 'cosplay-slacks-maroon'},
  {id: 'sushi-fan', label: 'Nigiri cosplay: sushi mascot hat, salmon hoodie, rice-white trousers', head: 'cosplay-sushi-hat', upper: 'cosplay-hoodie-salmon', lower: 'cosplay-slacks-rice'},
  {id: 'rose-uniform', label: 'Mascot cosplay, alternate palette: cream bear-ear hat, rose wig, navy uniform blazer, grey slacks', head: 'cosplay-bearhat-rose', upper: 'cosplay-blazer-navy', lower: 'slacks'},
];
/** Ordinary wearables a costume may reuse unchanged (its file is the ordinary boot model). */
const ORDINARY_PIECES = {slacks: {model: 'outfit_slacks', file: 'outfit-slacks-t25.glb'}};
/** Bodies whose own long hair hangs below a wig (it would show under the cut of the wig): no wig variant. */
const LONG_HAIR = ['paleGaze', 'paleRevenant', 'paleApparition'];
/** Fit gates and search ranges. */
const FIT = {
  wig: {k: [0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3], dz: [-0.01, 0, 0.01, 0.02], dy: [-0.01, 0, 0.01], cover: 0.16, maxPokes: 12, eyeClear: 0.25, bulkCap: 0.03},
  head: {s: [0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52, 0.55, 0.58, 0.62], dy: [-0.02, 0, 0.02, 0.04], noseGap: 0.02, maxOutside: 12, bulkCap: 0.08, hairCutY: 0.4},
  sushi: {widthM: 0.31, embed: 0.022, dz: [-0.02, -0.01, 0, 0.01, 0.02], belly: [0.03, 0.08], cover: 0.12, maxPokes: 12, bulkCap: 0.02},
  /** simplification targets (triangles) */
  simplify: {wig: 3600, head: 5000, sushi: 3600},
};

// ------------------------------------------------------------------------------------------------------------------------------
// glTF helpers

const floats = (accessor, comps) => { const n = accessor.getCount(), out = new Float32Array(n * comps), el = []; for (let i = 0; i < n; i++) { accessor.getElement(i, el); for (let c = 0; c < comps; c++) out[i * comps + c] = el[c]; } return out; };
async function imageRGB(img) { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height}; }
const jpeg = (rgb, q = 85) => sharp(Buffer.from(rgb.data), {raw: {width: rgb.width, height: rgb.height, channels: 3}}).jpeg({quality: q, mozjpeg: false, chromaSubsampling: '4:4:4'}).toBuffer();

async function loadBody(id) {
  const file = path.join(REPO, bodyFile(id));
  const doc = await io.read(file);
  const root = doc.getRoot();
  const node = root.listNodes().find(n => n.getName() === 'ZombieBody');
  const prim = node.getMesh().listPrimitives()[0];
  const skin = node.getSkin();
  const names = skin.listJoints().map(j => j.getName());
  if (names.join() !== JOINTS.map(j => j[0]).join()) throw new Error(`${id}: unexpected joint order`);
  const ibm = skin.getInverseBindMatrices().getArray();
  const jw = Object.fromEntries(names.map((n, i) => [n, [-ibm[i * 16 + 12], -ibm[i * 16 + 13], -ibm[i * 16 + 14]]]));
  const pos = floats(prim.getAttribute('POSITION'), 3), nrm = floats(prim.getAttribute('NORMAL'), 3);
  const idx = Uint32Array.from(prim.getIndices().getArray());
  const joints = Uint16Array.from(prim.getAttribute('JOINTS_0').getArray()), weights = floats(prim.getAttribute('WEIGHTS_0'), 4);
  const extras = root.listScenes()[0].getExtras().zombieBody;
  // dominant joint per vertex (first influence = largest in these files; verified below)
  const dom = new Uint8Array(pos.length / 3);
  for (let v = 0; v < dom.length; v++) { let b = 0; for (let k = 1; k < 4; k++) if (weights[v * 4 + k] > weights[v * 4 + b]) b = k; dom[v] = joints[v * 4 + b]; }
  // lib/headwear.mjs measureHead reads B.low.welded / weldedWeights / skel (the runtime bind mesh serves: slices ignore UV seams)
  const domJ = new Uint16Array(dom.length * 4), domW = new Float32Array(dom.length * 4);
  for (let v = 0; v < dom.length; v++) { domJ[v * 4] = dom[v]; domW[v * 4] = 1; }
  const B = {low: {welded: {pos, idx}, pos, idx, nrm}, weldedWeights: {joints: domJ, weights: domW}, joints: domJ, skel: {joints: jw}};
  return {id, file: bodyFile(id), pos, nrm, idx, joints, weights, dom, jw, extras, B, head: measureHead(B)};
}

// ------------------------------------------------------------------------------------------------------------------------------
// The mascot split

const hsv = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; };
const HAIR = 1, BROWN = 2, OTHER = 0;
function texelClass(r, g, b) {
  const [h, s, v] = hsv(r, g, b);
  if (h > 180 && h < 250 && s > 0.25 && v > 0.25) return HAIR;
  if ((h < 40 || h > 330) && v < 0.65 && v >= 0.18 && s > 0.3) return BROWN;
  return OTHER;
}
const sampleUV = (tex, u, v) => { const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width))), y = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height))); const i = (y * tex.width + x) * 3; return [tex.data[i], tex.data[i + 1], tex.data[i + 2]]; };

/** Welded vertex ids (same position) for connectivity across UV seams. */
function weldIds(pos) {
  const map = new Map(), out = new Uint32Array(pos.length / 3);
  for (let i = 0; i < out.length; i++) { const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`; let w = map.get(k); if (w === undefined) map.set(k, (w = map.size)); out[i] = w; }
  return out;
}
function components(tris, idx, wid) {
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const t of tris) for (let c = 0; c < 3; c++) { const w = wid[idx[t * 3 + c]]; if (!parent.has(w)) parent.set(w, w); }
  for (const t of tris) { const a = find(wid[idx[t * 3]]); for (let c = 1; c < 3; c++) { const b = find(wid[idx[t * 3 + c]]); if (a !== b) parent.set(b, a); } }
  const groups = new Map();
  for (const t of tris) { const r = find(wid[idx[t * 3]]); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(t); }
  return [...groups.values()];
}

async function loadMascot() {
  const file = 'game/public/assets/models/skyways-mascot-poses.glb';
  const doc = await io.read(path.join(REPO, file));
  const node = doc.getRoot().listNodes().find(n => n.getName() === 'stand');
  const prim = node.getMesh().listPrimitives()[0];
  const mat = prim.getMaterial();
  const pos = floats(prim.getAttribute('POSITION'), 3), nrm = floats(prim.getAttribute('NORMAL'), 3), uv = floats(prim.getAttribute('TEXCOORD_0'), 2);
  const idx = Uint32Array.from(prim.getIndices().getArray());
  const baseJpg = Buffer.from(mat.getBaseColorTexture().getImage()), normalJpg = Buffer.from(mat.getNormalTexture().getImage()), mrJpg = Buffer.from(mat.getMetallicRoughnessTexture().getImage());
  const base = await imageRGB(baseJpg);
  const nt = idx.length / 3, cls = new Uint8Array(nt), cy = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const k = [0, 0, 0];
    let y = 0;
    for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c]; const [r, g, b] = sampleUV(base, uv[v * 2], uv[v * 2 + 1]); k[texelClass(r, g, b)]++; y += pos[v * 3 + 1] / 3; }
    cls[t] = k[HAIR] >= 2 ? HAIR : k[BROWN] >= 2 ? BROWN : OTHER;
    cy[t] = y;
  }
  const wid = weldIds(pos);
  // the hat: brown above the shoulders (the skirt below is the same maroon); the hair: blue anywhere
  const isWig0 = t => cls[t] === HAIR || (cls[t] === BROWN && cy[t] > 0.8);
  const rest = []; for (let t = 0; t < nt; t++) if (!isWig0(t)) rest.push(t);
  const comps = components(rest, idx, wid).sort((a, b) => b.length - a.length);
  const big = comps[0];
  const minY = ts => Math.min(...ts.flatMap(t => [0, 1, 2].map(c => pos[idx[t * 3 + c] * 3 + 1])));
  // small pieces enclosed by the hat / hair (the bear-face appliqué, the pin, the hair clip, specks of shading)
  const smalls = comps.slice(1).filter(c => c.length < 1500 && minY(c) > 0.6);
  const wig = []; for (let t = 0; t < nt; t++) if (isWig0(t)) wig.push(t);
  wig.push(...smalls.flat());
  // the face above the neck (the costume head's front); landmarks from it
  const NECK_CUT = 0.6;
  const face = big.filter(t => [0, 1, 2].every(c => pos[idx[t * 3 + c] * 3 + 1] > NECK_CUT));
  // eye line: the dark iris texels of the face
  let ey = 0, en = 0;
  for (const t of face) for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c]; const [r, g, b] = sampleUV(base, uv[v * 2], uv[v * 2 + 1]); const [, , val] = hsv(r, g, b); if (val < 0.35 && pos[v * 3 + 2] > 0.15 && pos[v * 3 + 1] > 0.75 && pos[v * 3 + 1] < 1.05) { ey += pos[v * 3 + 1]; en++; } }
  ey /= en;
  let zf = -Infinity, halfW = 0, chin = Infinity;
  for (const t of face) for (let c = 0; c < 3; c++) {
    const v = idx[t * 3 + c], x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (Math.abs(y - ey) < 0.03 && Math.abs(x) < 0.04) zf = Math.max(zf, z);
    if (Math.abs(y - ey) < 0.03) halfW = Math.max(halfW, Math.abs(x));
    if (Math.abs(x) < 0.05 && z > 0.1) chin = Math.min(chin, y);
  }
  const stats = {sourceTriangles: nt, wigTriangles: wig.length, faceTriangles: face.length, smallPieces: smalls.length, landmarks: {eyeY: r4(ey), faceFrontZ: r4(zf), faceHalfWidthAtEyes: r4(halfW), chinY: r4(chin), neckCut: NECK_CUT}};
  return {file, pos, nrm, uv, idx, base, baseJpg, normalJpg, mrJpg, wig, face, cy, cls, stats, land: {ey, zf, halfW, chin}};
}

/** A sub-mesh of triangles `tris`, compacted and simplified to `target` triangles (UV seams kept: meshoptimizer simplifyWithAttributes). */
function subMesh(src, tris, target) {
  const remap = new Map(), P = [], N = [], U = [], I = [];
  for (const t of tris) for (let c = 0; c < 3; c++) {
    const v = src.idx[t * 3 + c];
    let w = remap.get(v);
    if (w === undefined) { w = remap.size; remap.set(v, w); P.push(src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2]); N.push(src.nrm[v * 3], src.nrm[v * 3 + 1], src.nrm[v * 3 + 2]); U.push(src.uv[v * 2], src.uv[v * 2 + 1]); }
    I.push(w);
  }
  let pos = Float32Array.from(P), nrm = Float32Array.from(N), uv = Float32Array.from(U), idx = Uint32Array.from(I);
  const before = idx.length / 3;
  if (target && before > target) {
    const [s] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, nrm, 3, [0.25, 0.25, 0.25], null, target * 3, 0.02, ['LockBorder']);
    const used = new Map(), P2 = [], N2 = [], U2 = [], I2 = [];
    for (const v of s) { let w = used.get(v); if (w === undefined) { w = used.size; used.set(v, w); P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N2.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]); U2.push(uv[v * 2], uv[v * 2 + 1]); } I2.push(w); }
    pos = Float32Array.from(P2); nrm = Float32Array.from(N2); uv = Float32Array.from(U2); idx = Uint32Array.from(I2);
  }
  return {pos, nrm, uv, idx, before, after: idx.length / 3};
}

/** The rose / cream alternate palette of the mascot's base map (hair hue -> rose, hat brown -> cream; every other texel unchanged). */
function rosePalette(base) {
  const out = new Uint8Array(base.data.length);
  for (let i = 0; i < base.data.length; i += 3) {
    const r = base.data[i], g = base.data[i + 1], b = base.data[i + 2];
    const k = texelClass(r, g, b);
    if (k === HAIR) {
      const [h, s, v] = hsv(r, g, b);
      const [nr, ng, nb] = hsvToRgb((h - 215 + 335 + 360) % 360, Math.min(1, s * 0.8), Math.min(1, v * 1.04));
      out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;
    } else if (k === BROWN) {
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const t = Math.min(1.25, L / 0.26);
      out[i] = clamp8(232 * t * 0.92); out[i + 1] = clamp8(220 * t * 0.92); out[i + 2] = clamp8(200 * t * 0.92);
    } else { out[i] = r; out[i + 1] = g; out[i + 2] = b; }
  }
  return {data: out, width: base.width, height: base.height};
}
const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));
function hsvToRgb(h, s, v) { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [clamp8((r + m) * 255), clamp8((g + m) * 255), clamp8((b + m) * 255)]; }

/** Dye a garment's base map: every texel = the dye colour x (texel luminance / the map's median luminance)^0.9, a 12 % trace of the original. */
function dye(base, rgb) {
  const n = base.data.length / 3, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * base.data[i * 3] + 0.7152 * base.data[i * 3 + 1] + 0.0722 * base.data[i * 3 + 2];
  const sorted = Float32Array.from(L).sort();
  const med = Math.max(8, sorted[Math.floor(n / 2)]);
  const out = new Uint8Array(base.data.length);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(L[i] / med, 0.9);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp8(0.88 * rgb[c] * t + 0.12 * base.data[i * 3 + c] * (rgb[c] / 255 + 0.5));
  }
  return {data: out, width: base.width, height: base.height, median: med};
}

// ------------------------------------------------------------------------------------------------------------------------------
// Rigid fits

const tf = (pos, s, o, t) => { const out = new Float32Array(pos.length); for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = (pos[i + c] - o[c]) * s + t[c]; return out; };

/** Body vertices near the head region (head / neck dominant, or anything above the shoulders): the hide candidates. */
function headVerts(body) {
  const out = [], y0 = body.head.noseY - 0.2;
  for (let v = 0; v < body.dom.length; v++) if (body.dom[v] === HEAD || body.dom[v] === NECK || body.pos[v * 3 + 1] > y0) out.push(v);
  return out;
}
/**
 * Per body vertex: covered (outward ray meets the piece within `cover`); POKES = Head-dominant vertices (scalp, hair, face) left
 * uncovered just outside the piece (its surface within 3 cm inward: skin / own hair through the wig or hat). Shoulders / chest under the
 * hanging locks are the garments' (they are not counted).
 */
function coverage(body, verts, grid, cover, minY = -Infinity) {
  const P = body.pos, N = body.nrm, covered = new Uint8Array(P.length / 3);
  let pokes = 0;
  for (const v of verts) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    if (grid.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, nx, ny, nz, cover)) { covered[v] = 1; continue; }
    if (body.dom[v] === HEAD && y > minY && grid.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, -nx, -ny, -nz, 0.03)) pokes++;
  }
  return {covered, pokes};
}
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0.7071, 0.7071, 0], [-0.7071, 0.7071, 0], [0, 0.7071, 0.7071], [0, 0.7071, -0.7071]];
const inside = (grid, x, y, z, far = 0.6) => DIRS.every(([dx, dy, dz]) => grid.ray(x, y, z, dx, dy, dz, far));
function eyesClear(body, grid, far) {
  const h = body.head, ey = h.noseY + 0.032;
  return [-0.032, 0.032].every(dx => !grid.ray(h.cx + dx, ey, h.noseZ - 0.03, 0, 0, 1, far));
}
function hideMask(body, isHidden) {
  const I = body.idx, nt = I.length / 3, hide = new Uint8Array(nt);
  let n = 0;
  for (let t = 0; t < nt; t++) if (isHidden(I[t * 3]) && isHidden(I[t * 3 + 1]) && isHidden(I[t * 3 + 2])) { hide[t] = 1; n++; }
  return {hide, n};
}
const bboxOf = pos => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) { b[c] = Math.min(b[c], pos[i + c]); b[c + 3] = Math.max(b[c + 3], pos[i + c]); } return b; };

/** The wig / bear hat: the mascot's face line mapped onto the body's (eye line, face front between the eyes, face width). */
function fitWig(body, wig, land) {
  const h = body.head, F = FIT.wig;
  if (LONG_HAIR.includes(body.id)) return {ok: false, reason: 'long own hair would hang below the wig', pos: wig.pos, mask: {hide: new Uint8Array(0), n: 0}, stats: {}};
  const eyeLv = h.levels.reduce((b, l) => Math.abs(l.y - (h.noseY + 0.032)) < Math.abs(b.y - (h.noseY + 0.032)) ? l : b, h.levels[0]);
  const bodyHalfW = (eyeLv.env.x1 - eyeLv.env.x0) / 2;
  const verts = headVerts(body);
  let best = null;
  for (const k of F.k) for (const dz of F.dz) for (const dy of F.dy) {
    const s = k * bodyHalfW / land.halfW;
    const pos = tf(wig.pos, s, [0, land.ey, land.zf], [h.cx, h.noseY + 0.032 + dy, h.noseZ - 0.012 + dz]);
    const grid = new TriGrid(pos, wig.idx, 0.02);
    if (!eyesClear(body, grid, F.eyeClear)) continue;
    const {pokes} = coverage(body, verts, grid, F.cover);
    const score = pokes + k * 2 + Math.abs(dz) * 50 + Math.abs(dy) * 50;
    if (!best || score < best.score) best = {score, k, dz, dy, s, pos, pokes};
  }
  if (!best) return {ok: false, reason: 'no fit keeps the eyes clear'};
  const grid = new TriGrid(best.pos, wig.idx, 0.02);
  const {covered} = coverage(body, verts, grid, F.cover);
  const mask = hideMask(body, v => covered[v] === 1);
  return {ok: best.pokes <= F.maxPokes, reason: best.pokes > F.maxPokes ? `${best.pokes} body vertices poke through` : '', pos: best.pos, mask,
    stats: {mode: 'rigid wig: mascot eye line / face front / face width mapped onto the body\'s, (k, dz, dy) searched', scale: r4(best.s), k: best.k, dz: best.dz, dy: best.dy, pokes: best.pokes, hidden: mask.n}};
}

/** The oversized costume head: the smallest scale that ENCLOSES the body's head (every head-dominant vertex inside), the nose behind its face. */
function fitHead(body, head, land) {
  const h = body.head, F = FIT.head;
  const hv = []; for (let v = 0; v < body.dom.length; v++) if (body.dom[v] === HEAD) hv.push(v);
  let best = null;
  for (const s of F.s) {
    for (const dy of F.dy) {
      // the body's nose tip F.noseGap behind the costume face at its eye line
      const t = [h.cx, h.noseY + 0.032 + dy, h.noseZ + F.noseGap];
      const pos = tf(head.pos, s, [0, land.ey, land.zf], t);
      const grid = new TriGrid(pos, head.idx, 0.03);
      let out = 0;
      for (const v of hv) if (!inside(grid, body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2])) out++;
      if (!best || out < best.out || (out === best.out && s < best.s)) best = {s, dy, pos, out, grid};
      if (out === 0) break;
    }
    if (best && best.out === 0) break;
  }
  const grid = best.grid;
  const ins = new Uint8Array(body.dom.length);
  const y0 = h.noseY - 0.2;
  // the whole real head is inside the costume head: every Head-dominant vertex is hidden (a vertex the inside test misses never pokes)
  for (let v = 0; v < ins.length; v++) if (body.dom[v] === HEAD || (body.pos[v * 3 + 1] > y0 && inside(grid, body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2]))) ins[v] = 1;
  const mask = hideMask(body, v => ins[v] === 1);
  return {ok: best.out <= F.maxOutside, reason: best.out > F.maxOutside ? `${best.out} head vertices outside` : '', pos: best.pos, mask,
    stats: {mode: 'rigid costume head: smallest scale enclosing every head vertex (9-direction inside test), nose behind the costume face', scale: r4(best.s), dy: best.dy, headVerticesOutside: best.out, hidden: mask.n}};
}

/**
 * The sushi hat: 0.31 m wide, level, its rice belly SEATED on the head: for every belly vertex (authored height in FIT.sushi.belly) the head
 * surface under it (a ray down onto the Head / Neck triangles), lifted so the lowest clearance is -embed (pressed into the hair); the
 * little feet sink into the hair (hidden). Fore-aft offset searched (fewest poking head vertices, eyes clear).
 */
function fitSushi(body, sushi) {
  const h = body.head, F = FIT.sushi, b = bboxOf(sushi.pos), s = F.widthM / (b[3] - b[0]);
  const verts = headVerts(body);
  const headTri = []; for (let t = 0; t < body.idx.length / 3; t++) if ([0, 1, 2].every(c => { const d = body.dom[body.idx[t * 3 + c]]; return d === HEAD || d === NECK; })) headTri.push(body.idx[t * 3], body.idx[t * 3 + 1], body.idx[t * 3 + 2]);
  const headGrid = new TriGrid(body.pos, Uint32Array.from(headTri), 0.02);
  const belly = []; for (let i = 0; i < sushi.pos.length / 3; i++) { const y = sushi.pos[i * 3 + 1] - b[1]; if (y >= F.belly[0] && y <= F.belly[1]) belly.push(i); }
  let best = null;
  for (const dz of F.dz) {
    const pos0 = tf(sushi.pos, s, [(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2], [h.cx, 0, h.cz + dz]);
    let lift = -Infinity;
    for (const i of belly) {
      const x = pos0[i * 3], y = pos0[i * 3 + 1], z = pos0[i * 3 + 2];
      const hit = headGrid.ray(x, h.top + 0.3, z, 0, -1, 0, 0.6);
      if (hit) lift = Math.max(lift, (h.top + 0.3 - hit.t) - y - F.embed);
    }
    if (!Number.isFinite(lift)) continue;
    const pos = Float32Array.from(pos0); for (let i = 1; i < pos.length; i += 3) pos[i] += lift;
    const grid = new TriGrid(pos, sushi.idx, 0.02);
    if (!eyesClear(body, grid, 0.25)) continue;
    // hair meeting the rice belly from below is the hat pressed into it: only head vertices 2 cm above the belly bottom count as poking
    const {pokes} = coverage(body, verts, grid, F.cover, lift + F.belly[0] * s + 0.02);
    const score = pokes + Math.abs(dz) * 20;
    if (!best || score < best.score) best = {score, dz, lift, pos, pokes};
  }
  if (!best) return {ok: false, reason: 'no seat', pos: sushi.pos, mask: {hide: new Uint8Array(0), n: 0}, stats: {}};
  const grid = new TriGrid(best.pos, sushi.idx, 0.02);
  const {covered} = coverage(body, verts, grid, F.cover);
  const mask = hideMask(body, v => covered[v] === 1);
  return {ok: best.pokes <= F.maxPokes, reason: best.pokes > F.maxPokes ? `${best.pokes} body vertices poke through` : '', pos: best.pos, mask,
    stats: {mode: 'rigid hat: level, rice belly seated on the head surface (ray-down contact, pressed 22 mm into the hair: the little feet sink out of sight), fore-aft searched', scale: r4(s), lift: r4(best.lift), dz: best.dz, pokes: best.pokes, hidden: mask.n}};
}

/** Head-hit bulk of a fitted head piece: its mean half extent above the eye line beyond the body's measured head radius (capped). */
function headBulk(body, pos, cap) {
  const b = bboxOf(pos), half = ((b[3] - b[0]) + (b[5] - b[2])) / 4;
  return r4(Math.max(0, Math.min(cap, half - body.extras.hit.head)));
}

// ------------------------------------------------------------------------------------------------------------------------------
// Writer: one GLB per slot, several wearables (own materials) per file

function addSkeleton(doc, buf, holder, jw, prefix, skinName) {
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? jw[name].map((v, c) => v - jw[parent][c]) : jw[name];
    const node = doc.createNode(prefix + name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else holder.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = jw[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin(skinName).setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor(skinName + '_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  return skin;
}
const acc = (doc, buf, type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
const qNormals = n => { const q = new Int8Array(n.length); for (let i = 0; i < n.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127))); return q; };
const indexArray = (idx, nv) => nv < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);

/**
 * slot: the file's wardrobe slot; materials: {key: {base, normal?, mr?, doubleSided, roughness, metallic}};
 * groups: [{bodyId, jw, geometry: {pos, nrm, uv, idx, joints (u8 x4), weights (u8 x4 normalized)}, wearables: [{id, material, extras}]}]
 * — every wearable of a group shares that group's accessors (one geometry per body, several dyes).
 */
function buildDocument({name, slot, wearables, materials, groups}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Outfit_' + name).setExtras({zombieWearable: {id: name, slot, kind: slot === 'head' ? 'rigid' : 'garment', heavy: false, wearables, provenance: 'derived from approved repository models (see derivatives/outfit-cosplay.json)', approved: false, gameReady: false}});
  // shared maps (one texture per key: the mascot's normal / metallic-roughness serve both palettes; a garment's MR map every dye)
  const shared = new Map();
  const tex = (key, img) => { if (!shared.has(key)) shared.set(key, doc.createTexture(key).setImage(img).setMimeType('image/jpeg')); return shared.get(key); };
  const mats = {};
  for (const [key, m] of Object.entries(materials)) {
    const mat = doc.createMaterial(`Cosplay_${key}`).setBaseColorTexture(tex(`Cosplay_${key}_baseColor`, m.base))
      .setRoughnessFactor(m.roughness ?? 1).setMetallicFactor(m.metallic ?? 1).setDoubleSided(!!m.doubleSided);
    if (m.normalImg) mat.setNormalTexture(tex(m.normalKey, m.normalImg));
    if (m.mrImg) mat.setMetallicRoughnessTexture(tex(m.mrKey, m.mrImg));
    mats[key] = mat;
  }
  const rigs = new Map();
  // identical attribute data (UVs / indices of one piece on every body; a rigid piece's normals / joints / weights) = ONE accessor
  const pool = new Map();
  const share = (type, arr, normalized) => {
    const key = `${type}|${arr.constructor.name}|${normalized ? 1 : 0}|${sha(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))}`;
    if (!pool.has(key)) pool.set(key, acc(doc, buf, type, arr, normalized));
    return pool.get(key);
  };
  for (const g of groups) {
    let skin = rigs.get(g.bodyId);
    if (!skin) { const holder = doc.createNode('Rig_' + g.bodyId); scene.addChild(holder); skin = addSkeleton(doc, buf, holder, g.jw, g.bodyId + '_', 'Skin_' + g.bodyId); rigs.set(g.bodyId, skin); }
    const G = g.geometry, nv = G.pos.length / 3;
    const a = {pos: share('VEC3', G.pos), nrm: share('VEC3', qNormals(G.nrm), true), uv: share('VEC2', G.uv), j: share('VEC4', G.joints), w: share('VEC4', G.weights, true), i: share('SCALAR', indexArray(G.idx, nv))};
    for (const w of g.wearables) {
      const prim = doc.createPrimitive().setMaterial(mats[w.material]).setAttribute('POSITION', a.pos).setAttribute('NORMAL', a.nrm).setAttribute('TEXCOORD_0', a.uv)
        .setAttribute('JOINTS_0', a.j).setAttribute('WEIGHTS_0', a.w).setIndices(a.i);
      const nodeName = `Outfit_${w.id}__${g.bodyId}`;
      scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)).setSkin(skin).setExtras(w.extras));
    }
  }
  return doc;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Garment copies

async function loadGarment(base) {
  const file = path.join(MODELS, `outfit-${base}-t25.glb`);
  const doc = await io.read(path.join(REPO, file));
  const root = doc.getRoot();
  const sx = root.listScenes()[0].getExtras().zombieWearable;
  const variants = {};
  let mat = null;
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName());
    if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0];
    mat ??= prim.getMaterial();
    variants[m[2]] = {extras: n.getExtras(), pos: floats(prim.getAttribute('POSITION'), 3), nrm: floats(prim.getAttribute('NORMAL'), 3), uv: floats(prim.getAttribute('TEXCOORD_0'), 2),
      idx: Uint32Array.from(prim.getIndices().getArray()), joints: Uint8Array.from(prim.getAttribute('JOINTS_0').getArray()), weights: Uint8Array.from(prim.getAttribute('WEIGHTS_0').getArray())};
    if (prim.getAttribute('WEIGHTS_0').getComponentSize() !== 1 || prim.getAttribute('JOINTS_0').getComponentSize() !== 1) throw new Error(`${file}: expected u8 joints / weights`);
  }
  const baseJpg = Buffer.from(mat.getBaseColorTexture().getImage()), mrJpg = mat.getMetallicRoughnessTexture() ? Buffer.from(mat.getMetallicRoughnessTexture().getImage()) : null;
  return {file, sha256: sha(fs.readFileSync(path.join(REPO, file))), sx, variants, baseJpg, mrJpg, roughness: mat.getRoughnessFactor(), metallic: mat.getMetallicFactor()};
}

/** Ordinary wearable id -> the cosplay ids made from it (extras keys hideWear / incompatibleWear are renamed onto the cosplay ids). */
const COSPLAY_OF = (() => { const m = {}; for (const list of Object.values(GARMENTS)) for (const [id, base] of list) (m[base] ??= []).push(id); return m; })();
function remapExtras(ex, id) {
  const out = {...ex, outfit: id};
  if (ex.hideWear) {
    const hw = {};
    for (const [k, v] of Object.entries(ex.hideWear)) { hw[k] = v; for (const c of COSPLAY_OF[k] ?? []) hw[c] = v; }
    out.hideWear = hw;
    if (ex.hideWearCounts) { const hc = {}; for (const [k, v] of Object.entries(ex.hideWearCounts)) { hc[k] = v; for (const c of COSPLAY_OF[k] ?? []) hc[c] = v; } out.hideWearCounts = hc; }
  }
  if (ex.incompatibleWear) out.incompatibleWear = [...new Set(ex.incompatibleWear.flatMap(k => [k, ...(COSPLAY_OF[k] ?? [])]))];
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------

async function build(outRoot) {
  await MeshoptSimplifier.ready;
  const bodies = {};
  for (const id of BODY_IDS) bodies[id] = await loadBody(id);
  const mascot = await loadMascot();
  // --- head pieces (sources)
  const wig = subMesh(mascot, mascot.wig, FIT.simplify.wig);
  // the costume head: the wig + the face above the neck; the back hair cut at hairCutY (it would lie on the shoulders)
  const headTris = [...mascot.wig.filter(t => mascot.cy[t] > FIT.head.hairCutY), ...mascot.face];
  const head = subMesh(mascot, headTris, FIT.simplify.head);
  const sushiFile = 'game/public/assets/models/skyways-sushi-mascot.glb';
  const sp = (await io.read(path.join(REPO, sushiFile))).getRoot().listMeshes()[0].listPrimitives()[0];
  const sushiSrc = {pos: floats(sp.getAttribute('POSITION'), 3), nrm: floats(sp.getAttribute('NORMAL'), 3), uv: floats(sp.getAttribute('TEXCOORD_0'), 2), idx: Uint32Array.from(sp.getIndices().getArray())};
  const sushi = subMesh(sushiSrc, [...Array(sushiSrc.idx.length / 3).keys()], FIT.simplify.sushi);
  const sushiJpg = Buffer.from(sp.getMaterial().getBaseColorTexture().getImage());
  const rose = await jpeg(rosePalette(mascot.base), 85);
  const PIECE = Object.fromEntries(HEADS.map(h => [h.id, h]));
  // --- fits of every head piece on every body
  const fits = {}, headFits = {};
  for (const id of BODY_IDS) {
    const b = bodies[id];
    fits[id] = {wig: fitWig(b, wig, mascot.land), head: fitHead(b, head, mascot.land), sushi: fitSushi(b, sushi)};
    if (ARGS.has('--no-gate')) for (const f of Object.values(fits[id])) if (f.mask.hide.length) f.ok = true;
    headFits[id] = Object.fromEntries(Object.entries(fits[id]).map(([k, f]) => [k, {ok: f.ok, reason: f.reason, ...f.stats}]));
  }
  // --- the garments (ordinary fitted files) and the reused ordinary pieces
  const garments = {};
  for (const base of [...new Set([...GARMENTS.upper, ...GARMENTS.lower].map(g => g[1]))]) garments[base] = await loadGarment(base);
  const garmentOf = id => { for (const list of Object.values(GARMENTS)) for (const g of list) if (g[0] === id) return garments[g[1]]; return null; };
  const baseOf = id => { for (const list of Object.values(GARMENTS)) for (const g of list) if (g[0] === id) return g[1]; return id; };
  const ordinary = {};
  for (const [id, o] of Object.entries(ORDINARY_PIECES)) {
    const root = (await io.read(path.join(REPO, MODELS, o.file))).getRoot();
    ordinary[id] = {};
    for (const n of root.listNodes()) { const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (m && m[1] === id && bodies[m[2]] && n.getExtras().bodyGeometryHash === bodies[m[2]].extras.geometryHash) ordinary[id][m[2]] = n.getExtras(); }
  }
  const variantExtras = (piece, body) => garmentOf(piece)?.variants[body]?.extras ?? ordinary[piece]?.[body] ?? null;
  const fitted = (piece, body) => PIECE[piece] ? !!fits[body][PIECE[piece].piece].ok : !!variantExtras(piece, body);
  // upper x lower layering exclusions of the base garments on that body (variant extras incompatibleWear)
  const layeringOk = (c, body) => !(variantExtras(c.upper, body)?.incompatibleWear ?? []).includes(baseOf(c.lower)) && !(variantExtras(c.lower, body)?.incompatibleWear ?? []).includes(baseOf(c.upper));
  const costumes = COSTUMES.map(c => ({...c, bodies: BODY_IDS.filter(b => ['head', 'upper', 'lower'].every(sl => fitted(c[sl], b)) && layeringOk(c, b))}));
  /** the bodies each piece ships for = the union of its costumes' bodies */
  const shipFor = piece => [...new Set(costumes.filter(c => [c.head, c.upper, c.lower].includes(piece)).flatMap(c => c.bodies))].sort((a, b) => BODY_IDS.indexOf(a) - BODY_IDS.indexOf(b));
  // --- head file
  const headGroups = [];
  const rigid = n => { const j = new Uint8Array(n * 4), w = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { j[i * 4] = HEAD; w[i * 4] = 255; } return {joints: j, weights: w}; };
  const src = {wig, head, sushi};
  for (const id of BODY_IDS) {
    const b = bodies[id];
    const common = {bodyTriangles: b.idx.length / 3, bodyGeometryHash: b.extras.geometryHash, slot: 'head', body: id};
    for (const piece of ['wig', 'head', 'sushi']) {
      const ids = HEADS.filter(h => h.piece === piece && shipFor(h.id).includes(id));
      if (!ids.length) continue;
      const f = fits[id][piece], q = rigid(f.pos.length / 3), bulk = headBulk(b, f.pos, FIT[piece].bulkCap);
      headGroups.push({bodyId: id, jw: b.jw, geometry: {pos: f.pos, nrm: src[piece].nrm, uv: src[piece].uv, idx: src[piece].idx, joints: q.joints, weights: q.weights},
        wearables: ids.map(h => ({id: h.id, material: h.palette, extras: {...common, outfit: h.id, hideBodyTriangles: bitsetBase64(f.mask.hide), hiddenCount: f.mask.n, bulkM: {torso: 0, arm: 0, head: bulk}}}))});
    }
  }
  const headWearables = HEADS.map(h => ({id: h.id, label: h.label, bodies: shipFor(h.id)}));
  const headDoc = buildDocument({name: 'cosplay-head', slot: 'head', wearables: headWearables,
    materials: {blue: {base: mascot.baseJpg, normalImg: mascot.normalJpg, normalKey: 'Cosplay_mascot_normal', mrImg: mascot.mrJpg, mrKey: 'Cosplay_mascot_mr', doubleSided: true},
      rose: {base: rose, normalImg: mascot.normalJpg, normalKey: 'Cosplay_mascot_normal', mrImg: mascot.mrJpg, mrKey: 'Cosplay_mascot_mr', doubleSided: true},
      sushi: {base: sushiJpg, doubleSided: true, roughness: 0.8, metallic: 0}},
    groups: headGroups});
  // --- dyed garment files
  const garmentDocs = {}, garmentInfo = {}, garmentWearables = {};
  for (const slot of ['upper', 'lower']) {
    const groups = [], materials = {}, wearables = [];
    for (const baseId of [...new Set(GARMENTS[slot].map(g => g[1]))]) {
      const G = garments[baseId];
      const srcTex = await imageRGB(G.baseJpg);
      const list = GARMENTS[slot].filter(g => g[1] === baseId);
      for (const [cid, , dyeId] of list) {
        const d = dye(srcTex, DYES[dyeId].rgb);
        materials[cid] = {base: await jpeg(d, 85), mrImg: G.mrJpg, mrKey: `Cosplay_${baseId}_mr`, roughness: G.roughness, metallic: G.metallic};
        garmentInfo[cid] = {base: baseId, baseFile: G.file, baseSha256: G.sha256, dye: dyeId, dyeRgb: DYES[dyeId].rgb, sourceMedianLuma: r4(d.median)};
      }
      for (const bodyId of BODY_IDS) {
        const v = G.variants[bodyId], ids = list.filter(([cid]) => shipFor(cid).includes(bodyId));
        if (!v || !ids.length) continue;
        if (v.extras.bodyGeometryHash !== bodies[bodyId].extras.geometryHash) throw new Error(`${G.file} x ${bodyId}: stale body hash`);
        groups.push({bodyId, jw: bodies[bodyId].jw, geometry: {pos: v.pos, nrm: v.nrm, uv: v.uv, idx: v.idx, joints: v.joints, weights: v.weights},
          wearables: ids.map(([cid]) => ({id: cid, material: cid, extras: remapExtras(v.extras, cid)}))});
      }
      for (const [cid, , , label] of list) wearables.push({id: cid, label, base: baseId, bodies: shipFor(cid)});
    }
    garmentWearables[slot] = wearables;
    garmentDocs[slot] = buildDocument({name: `cosplay-${slot}`, slot, wearables, materials, groups});
  }
  // --- write
  const models = path.join(outRoot, MODELS), deriv = path.join(outRoot, 'game/public/assets/derivatives'), gen = path.join(outRoot, 'game/src/ai');
  for (const d of [models, deriv, gen]) fs.mkdirSync(d, {recursive: true});
  const files = {head: 'outfit-cosplay-head.glb', upper: 'outfit-cosplay-upper.glb', lower: 'outfit-cosplay-lower.glb'};
  const out = {};
  for (const [slot, doc] of [['head', headDoc], ['upper', garmentDocs.upper], ['lower', garmentDocs.lower]]) {
    const bin = await io.writeBinary(doc);
    fs.writeFileSync(path.join(models, files[slot]), bin);
    out[slot] = {file: `${MODELS}/${files[slot]}`, url: `assets/models/${files[slot]}`, bytes: bin.byteLength, sha256: sha(bin)};
  }
  const wearRecord = {head: headWearables, upper: garmentWearables.upper, lower: garmentWearables.lower};
  const manifest = {
    schema: 'terminal-state-derivative-v1', id: 'outfit-cosplay', task: TASK, status: STATUS,
    item: 'Convention cosplay costume pieces for the ordinary zombie (Skyways anime convention, layout version 5): head pieces split from the convention mascot statue / the sushi mascot figurine, and dyed copies of fitted ordinary garments',
    generation: 'none - no model / image / audio generation, no Meshy, no Codex: deterministic processing (split, simplify, rigid fit, colour transform) of models already shipped in this repository',
    sources: {
      mascot: {file: mascot.file, node: 'stand', sha256: sha(fs.readFileSync(path.join(REPO, mascot.file))), provenance: 'assets/derivatives/skyways-mascot-poses.json', maps: 'base colour / normal / metallic-roughness kept (re-encoded only); the rose palette = a per-texel hue / value transform of the base colour (hair hue -> rose, hat brown -> cream)'},
      sushi: {file: sushiFile, sha256: sha(fs.readFileSync(path.join(REPO, sushiFile))), provenance: 'assets/derivatives/skyways-sushi-mascot.json', maps: 'base colour kept'},
      garments: garmentInfo,
      ordinary: Object.fromEntries(Object.entries(ORDINARY_PIECES).map(([id, o]) => [id, {model: o.model, file: `${MODELS}/${o.file}`, use: 'reused unchanged (the ordinary boot file)'}])),
      bodies: Object.fromEntries(BODY_IDS.map(id => [id, {file: bodies[id].file, geometryHash: bodies[id].extras.geometryHash}])),
    },
    method: [
      'mascot split: each triangle classed by its base-colour texels (blue hair: hue 180-250, s > 0.25, v > 0.25; hat maroon-brown: hue < 40 or > 330, s > 0.3, 0.18 <= v < 0.65, above y 0.8 m - the skirt below is the same colour); the remaining triangles\' connected components (welded across UV seams): the largest = body / face, small ones above y 0.6 m enclosed by the hat / hair (the bear-face appliqué, the pin, the hair clip) join the hat',
      `wig / bear hat = hat + hair + enclosed pieces (${mascot.stats.wigTriangles} source triangles -> ${wig.after}); costume head = that (hair above y ${FIT.head.hairCutY} m) + the face above y ${mascot.stats.landmarks.neckCut} m (${headTris.length} -> ${head.after}); sushi hat ${sushi.before} -> ${sushi.after}; meshoptimizer simplifyWithAttributes (normal-weighted, border locked)`,
      'rigid fit per body (all weights on the Head joint): body head landmarks by lib/headwear.mjs measureHead on the runtime bind mesh; wig: the mascot eye line / face front / face half-width mapped onto the body\'s, scale factor and small offsets searched (eyes kept clear, poking head vertices minimised; long-haired bodies excluded: their hair hangs below the wig); costume head: the smallest scale enclosing every head vertex (9-direction ray inside test), the nose 2 cm behind its face, the whole real head hidden; sushi hat: 0.31 m wide, level, its rice belly seated on the head surface (ray-down contact, 22 mm into the hair)',
      'hidden body triangles: all three vertices covered (outward normal ray meets the piece within the cover distance) or inside the costume head; a body whose best fit leaves more poking head vertices than the gate gets no variant; a piece ships only for the bodies of the costumes it belongs to (every piece of the costume fitted, upper x lower layering allowed)',
      'dyed garments: geometry, UVs, skin weights, body masks and layering masks of the ordinary fitted garment copied unchanged (layering keys extended to the cosplay ids); base colour = dye colour x (texel luminance / median luminance)^0.9 + a 12 % trace of the original texel; metallic-roughness map kept',
      'identical attribute data shared across body variants (one accessor): UVs / indices, a rigid piece\'s normals / joints / weights',
    ],
    mascotSplit: mascot.stats,
    fit: {gates: FIT, longHairNoWig: LONG_HAIR, perBody: headFits},
    dyes: DYES,
    costumes: costumes.map(c => ({id: c.id, label: c.label, pieces: {head: c.head, upper: c.upper, lower: c.lower}, bodies: c.bodies})),
    wearables: wearRecord,
    outputs: out,
  };
  fs.writeFileSync(path.join(deriv, 'outfit-cosplay.json'), JSON.stringify(manifest, null, 1) + '\n');
  const str = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
  const q = v => Array.isArray(v) ? `[${v.map(str).join(', ')}]` : str(v);
  const ts = [
    `// GENERATED by tools/asset-pipeline/zombie/build-cosplay.mjs (task ${TASK}) - do not edit.`,
    '// The shipped convention cosplay files (model key, url, exact bytes, slot, the wearables inside with the bodies each is fitted to) and the',
    '// COSTUMES (one piece per slot; the bodies every piece of it is fitted to). Logic: ai/cosplay.ts. Provenance: assets/derivatives/outfit-cosplay.json.',
    'export interface CosplayBuildFile {',
    '  model: string; url: string; bytes: number; slot: \'head\' | \'upper\' | \'lower\';',
    '  wearables: readonly {id: string; label: string; bodies: readonly string[]}[];',
    '}',
    'export interface CosplayBuildCostume { id: string; label: string; pieces: {head: string; upper: string; lower: string}; bodies: readonly string[] }',
    'export const COSPLAY_FILES: readonly CosplayBuildFile[] = [',
    ...['head', 'upper', 'lower'].map(slot => `  {model: 'outfit_cosplay_${slot}', url: '${out[slot].url}', bytes: ${out[slot].bytes}, slot: '${slot}', wearables: [\n${wearRecord[slot].map(w => `    {id: '${w.id}', label: ${q(w.label)}, bodies: ${q(w.bodies)}},`).join('\n')}\n  ]},`),
    '];',
    'export const COSPLAY_BUILD_COSTUMES: readonly CosplayBuildCostume[] = [',
    ...costumes.map(c => `  {id: '${c.id}', label: ${q(c.label)}, pieces: {head: '${c.head}', upper: '${c.upper}', lower: '${c.lower}'}, bodies: ${q(c.bodies)}},`),
    '];',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(gen, 'cosplay.generated.ts'), ts);
  return {manifest, out};
}

const OUTPUTS = [`${MODELS}/outfit-cosplay-head.glb`, `${MODELS}/outfit-cosplay-upper.glb`, `${MODELS}/outfit-cosplay-lower.glb`, 'game/public/assets/derivatives/outfit-cosplay.json', 'game/src/ai/cosplay.generated.ts'];
if (ARGS.has('--check')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosplay-check-'));
  await build(tmp);
  const bad = OUTPUTS.filter(f => !fs.existsSync(path.join(REPO, f)) || !fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(REPO, f))));
  fs.rmSync(tmp, {recursive: true, force: true});
  if (bad.length) { console.error('cosplay --check: differs:', bad.join(', ')); process.exit(1); }
  console.log('cosplay --check: every output byte-identical');
} else {
  const root = OPT.out ? path.resolve(OPT.out) : REPO;
  const {manifest, out} = await build(root);
  const brief = Object.fromEntries(Object.entries(manifest.fit.perBody).map(([b, f]) => [b, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, `${v.ok ? 'ok' : 'NO'} ${v.pokes ?? v.headVerticesOutside ?? ''} s=${v.scale ?? ''} ${v.reason}`]))]));
  console.log(JSON.stringify({fit: brief, split: manifest.mascotSplit, costumes: manifest.costumes, outputs: out}, null, 1));
}
