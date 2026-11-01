#!/usr/bin/env node
// Task office-props-physics-scale-20261030 (lane SCALE): prop SCALE CHECK — a CPU orthographic render (no browser / GPU / Blender)
// of prop GLBs at their RUNTIME transform, standing BESIDE an actual runtime-scaled standing zombie on one shared ground line, plus a
// measurement report (W x H x D, grounded contact, furniture-only bounds, top-surface heights).
//
// Standing user rule (root CLAUDE.md "Props — core design rules"): every new or changed prop is inspected in a rendered size
// comparison beside a runtime-scaled zombie; record its dimensions and grounded contact; furniture-only bounds (not a box including
// loose beakers / monitors); never rescale the reference zombie to flatter a prop. LOOK at the PNG — the numbers are not the check.
//
// Runtime transforms reproduced (resolved from the game's own TS data, bundled on the fly with the installed rolldown):
//  - openable kinds (world/openablesSpec.ts body 'model': labBench, officeFiling, serverRack, ...) -> world/meshSplit.ts fittedMeshes:
//    NON-uniform fit to PROP_DEFS w,h,d, centred x/z, min y = 0, half turn when spec.turn (office files face -Z);
//  - other container kinds (cabinets, crates) -> fittedMeshes, no turn;
//  - office / company kinds (+ `desk` inside office sections) -> world/officeProps.ts: UNIFORM k = min(def.w / size.x, def.d / size.z),
//    then FLIP (half turn about Y); the water tower is lifted onto its procedural stand (not drawn here);
//  - iteration-07 kinds (gen/props07.ts) and Subway MODEL_FOR kinds (world/builder.ts) -> addInstancedModel: NON-uniform fit to
//    PROP_DEFS w,h,d, no turn.
// The fit uses three.js Box3.setFromObject semantics (each primitive's local AABB through its node's world matrix), like the game.
// Prop frame of the render: origin bottom centre, front +Z (front view looks at the front; side view looks from +X, front at LEFT).
// Zombie: game/public/assets/models/zombie-body-<id>-t25.glb, A-pose bind mesh at its baked heightM (sidecar
// derivatives/zombie-body-<id>.json), runtime root scale 1.0 = the median of ai/zombieActor.ts 0.95 + rand * 0.1.
//
// usage:
//   node tools/asset-pipeline/props/scale-check.mjs [global options] <prop> [<prop options>] [<prop> [<prop options>] ...]
//   <prop>:  --kind <propKind>        runtime model + transform from the game data (PROP_DEFS, openables, office / company assets)
//            --prop <file.glb>        any GLB; transform from the prop options below (default: as authored, grounded, centred)
//   prop options (apply to the preceding prop):
//            --model <file.glb>       (with --kind) swap in another GLB under the kind's runtime fit (as if the file were replaced)
//            --fit w,h,d              non-uniform fit to a box (fittedMeshes / addInstancedModel)
//            --fit-wd w,d             office uniform fit k = min(w / size.x, d / size.z)
//            --scale s | sx,sy,sz     explicit scale (after centring / grounding)
//            --turn                   half turn about Y (office / company files face -Z)
//            --lift y                 raise the model (P7 wall mounts, the water tower's stand)
//            --below y                furniture-only body = geometry below y (m, runtime frame; triangles are clipped exactly)
//            --exclude <regex>        furniture-only body = everything except nodes / meshes / materials matching the regex
//            --floor y                floor height the contact gap is measured against (default 0)
//            --label <text>
//   global:  --out <file.png>         default qa-artifacts/scale-check/<names>.png (git-ignored); the JSON report goes next to it
//            --json <file.json>
//            --zombie <id>            lastshift (default) | courier | agent | scavenger | heavyset | tall
//            --zombie-scale <s>       runtime root scale, default 1.0; only 0.95 .. 1.05 (the game's range) is accepted
//            --ppm <px per metre>     default 200 (reduced automatically to keep the sheet <= --max-width px wide, default 4200)
//            --no-refs                hide the human-scale reference lines (seat 0.45 / desk 0.75 / counter 0.90 / door 2.00 m)
//            --batch <k1,k2,..|office|company|base>  one sheet per --per kinds (default 4); --out is then a path PREFIX
//            --list <k1,k2,..|office|company|base>   print the resolved runtime model / transform per kind, no render
// Examples:
//   node tools/asset-pipeline/props/scale-check.mjs --kind beanBag --kind labBench --below 0.8 --out /tmp/sc.png
//   node tools/asset-pipeline/props/scale-check.mjs --kind tradingDesk --model /tmp/trading-desk-new.glb
//   node tools/asset-pipeline/props/scale-check.mjs --prop game/public/assets/models/office-bean-bag.glb --turn --scale 1.25
//   node tools/asset-pipeline/props/scale-check.mjs --batch office --per 4 --out evidence/SCALE/catalog
// Report (stdout + JSON) per prop: runtime path / scale / turn, W x H x D (full and furniture-only body), min-y and the grounded
// contact (clusters of geometry within 2 cm of the lowest point, floor gap, a "base" height when the lowest point is only a speck),
// and top-surface plateaus from a 1 cm top-down height map (the highest broad one = the work / seat surface candidate).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GAME = path.join(ROOT, 'game');
const PUBLIC = path.join(GAME, 'public');
const ZOMBIE_IDS = ['lastshift', 'courier', 'agent', 'scavenger', 'heavyset', 'tall'];
const REFS = [[0.45, 'seat 0.45'], [0.75, 'desk 0.75'], [0.9, 'counter 0.90'], [2.0, 'door 2.00']];
const CONTACT_BAND = 0.02; // m above the lowest point that counts as floor contact
const RENDER_TRI_CAP = 250_000; // per object: above this only every n-th triangle is drawn (measurements always use all)

// ---------------------------------------------------------------------------------------------
// Game data (PROP_DEFS, openables, office / company / P7 / Subway model files) — bundled from the TS sources, never hand-copied

let runtimeData = null;
export async function loadRuntime() {
  if (runtimeData) return runtimeData;
  // rolldown = vite 8's bundler (installed with vite; no extra dependency)
  const {rolldown} = await import(pathToFileURL(require.resolve('rolldown', {paths: [ROOT, path.dirname(require.resolve('vite/package.json', {paths: [ROOT]}))]})).href);
  const G = path.join(GAME, 'src').split(path.sep).join('/');
  const entry = [
    `export {PROP_DEFS} from '${G}/gen/props';`,
    `export {isOfficeKind, officeKindAsset, officeModelKey, OFFICE_KINDS} from '${G}/gen/office/kinds';`,
    `export {COMPANY_KINDS, WATER_TOWER_STAND} from '${G}/gen/office/companyKinds';`,
    `export {openableSpec} from '${G}/world/openablesSpec';`,
    `export {isContainerKind} from '${G}/items/loot';`,
    `export {isP7Kind, p7ModelKey, p7Spec, P7_FILES} from '${G}/gen/props07';`,
    `export {MODEL_FILES} from '${G}/assets/manifest';`,
    // task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): authored procedural purpose shapes (box parts) render too
    `export {purposePropShape, PURPOSE_ACCENT} from '${G}/gen/purposeShapes';`,
    `export {PURPOSE_PROP_KINDS, PURPOSE_MODEL_KEYS} from '${G}/gen/props';`,
    // task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): procedural PROP shapes (gen/propShapes.ts box parts: the camp lantern / stove)
    `export {propShape, ACCENT_COLORS} from '${G}/gen/propShapes';`,
  ].join('\n');
  const bundle = await rolldown({
    input: 'scale-check-entry', platform: 'node', logLevel: 'silent',
    external: id => id !== 'scale-check-entry' && !id.startsWith('.') && !id.startsWith('/'),
    plugins: [{name: 'scale-check-entry', resolveId: id => (id === 'scale-check-entry' ? id : null), load: id => (id === 'scale-check-entry' ? entry : null)}],
  });
  const {output} = await bundle.generate({format: 'esm'});
  await bundle.close();
  const tmp = path.join(os.tmpdir(), `scale-check-runtime-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, output[0].code);
  let m;
  try { m = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, {force: true}); }
  // world/builder.ts MODEL_FOR is module-private (the builder imports three/webgpu): read its literal.
  const builder = fs.readFileSync(path.join(GAME, 'src/world/builder.ts'), 'utf8');
  const lit = /const MODEL_FOR[^=]*=\s*\{([^}]*)\}/.exec(builder)?.[1] ?? '';
  const MODEL_FOR = Object.fromEntries([...lit.matchAll(/(\w+):\s*'(\w+)'/g)].map(x => [x[1], x[2]]));
  runtimeData = {...m, MODEL_FOR};
  return runtimeData;
}

/** Runtime model file of a library key (manifest / office-<asset> / p7_<kind>), or null. */
function modelFileOf(rt, key) {
  if (!key) return null;
  let url = rt.MODEL_FILES[key]?.url ?? rt.P7_FILES[key]?.url ?? null;
  if (!url && key.startsWith('office-')) url = `assets/models/${key}.glb`; // OFFICE_MODEL_FILES / COMPANY_MODEL_FILES naming
  if (!url) return null;
  const f = path.join(PUBLIC, url);
  return fs.existsSync(f) ? f : null;
}

/** The runtime model + transform of a prop kind, exactly as the game builds it (see the header). */
export async function resolveKind(kind) {
  const rt = await loadRuntime();
  const def = rt.PROP_DEFS[kind];
  if (!def) throw new Error(`unknown prop kind '${kind}' (not in PROP_DEFS)`);
  const box = {w: def.w, h: def.h, d: def.d};
  const spec = rt.openableSpec(kind);
  if (spec && spec.body === 'model' && spec.model) {
    const file = modelFileOf(rt, spec.model);
    if (file) return {kind, file, path: 'openable (world/openables.ts fittedMeshes)', fit: {type: 'box', ...box}, turn: !!spec.turn, lift: 0, def, modelKey: spec.model};
  }
  if (rt.isContainerKind(kind) && rt.MODEL_FILES[kind]) {
    const file = modelFileOf(rt, kind);
    if (file) return {kind, file, path: 'container (world/containers.ts fittedMeshes)', fit: {type: 'box', ...box}, turn: false, lift: 0, def, modelKey: kind};
  }
  const asset = rt.officeKindAsset(kind);
  if (asset && (rt.isOfficeKind(kind) || kind === 'desk')) {
    const key = rt.officeModelKey(asset), file = modelFileOf(rt, key);
    const notes = kind === 'desk' ? ['office sections only (the Subway desk is procedural)'] : [];
    if (kind === 'waterTower') notes.push(`lifted ${rt.WATER_TOWER_STAND} m onto its procedural steel stand (stand not drawn)`);
    if (file) return {kind, file, path: 'office (world/officeProps.ts uniform fit + FLIP)', fit: {type: 'uniform-wd', w: def.w, d: def.d}, turn: true,
      lift: kind === 'waterTower' ? rt.WATER_TOWER_STAND : 0, def, modelKey: key, notes};
  }
  if (rt.isP7Kind(kind)) {
    const key = rt.p7ModelKey(kind), file = modelFileOf(rt, key);
    const mount = rt.p7Spec(kind).uses.some(u => u.at === 'mount');
    if (file) return {kind, file, path: 'iteration-07 (world/storefrontBuilder.ts addInstancedModel)', fit: {type: 'box', ...box}, turn: false, lift: 0, def, modelKey: key,
      notes: mount ? ['wall mount: placements render at their mount height / `lift` (drawn here on the floor)'] : []};
  }
  if (kind !== 'fareGate' && rt.MODEL_FOR[kind]) {
    const key = rt.MODEL_FOR[kind], file = modelFileOf(rt, key);
    if (file) return {kind, file, path: 'Subway model (world/builder.ts MODEL_FOR addInstancedModel)', fit: {type: 'box', ...box}, turn: false, lift: 0, def, modelKey: key};
  }
  // task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a purpose kind without a runtime model renders its AUTHORED box parts
  // (gen/purposeShapes.ts purposePropShape, variant 0) exactly as world/storefrontBuilder.ts buildPurposeProps builds them: prop frame,
  // no fit / scale (the parts are authored in metres inside PROP_DEFS)
  if (rt.PURPOSE_PROP_KINDS.includes(kind) && !rt.PURPOSE_MODEL_KEYS[kind]) {
    const parts = rt.purposePropShape(kind, 0);
    if (parts?.length) return {kind, file: path.join(GAME, 'src/gen/purposeShapes.ts'), parts, accent: rt.PURPOSE_ACCENT[kind]?.[0] ?? 0xb0a890,
      path: 'procedural purpose shape (gen/purposeShapes.ts parts; world/storefrontBuilder.ts buildPurposeProps)', fit: null, turn: false, lift: 0, def, modelKey: null,
      notes: ['authored box parts (no model file): drawn with flat stand-in colours per material key']};
  }
  // task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): a procedural PROP shape (gen/propShapes.ts propShape: the hideout's camp lantern /
  // stove, the core's table / desk ...) renders its box parts exactly as world/builder.ts addProceduralProp instances them (prop frame, metres)
  {
    const parts = rt.propShape(kind);
    if (parts?.length) return {kind, file: path.join(GAME, 'src/gen/propShapes.ts'), parts, accent: rt.ACCENT_COLORS[kind]?.[0] ?? 0xb0a890,
      path: 'procedural prop shape (gen/propShapes.ts parts; world/builder.ts addProceduralProp)', fit: null, turn: false, lift: 0, def, modelKey: null,
      notes: ['authored box parts (no model file): drawn with flat stand-in colours per material key']};
  }
  return {kind, file: null, path: 'procedural box form (no runtime model)', def};
}

/** Flat stand-in colours (0..1, x200 in the rasterizer) of the authored part materials (world/shapeMaterials.ts / purposeTextures.ts). */
const PART_RGB = {
  wood: 0x8a6a45, woodVeneer: 0x8a6a45, vinyl: 0x56604a, cardboard: 0xa8865a, steelDark: 0x3a3d40, steelBright: 0xa9adb0, black: 0x1e1e1e,
  panel: 0x8f9396, partition: 0xa3b3ae, counter: 0xb9b2a4, concrete: 0x8c8a85, porcelain: 0xe6e4df,
  paintRed: 0xb23a2e, paintYellow: 0xd9a520, paintGreen: 0x3f7d4a, paintWhite: 0xe8e4da, paintBlue: 0x2f5f9a, paintOrange: 0xd9732a,
  glass: 0xc8d8dc, lanternGlow: 0xffd27a, // lane HIDEOUT (round 3): the lantern globe / mantle
};
/**
 * Triangles of authored box parts ({m, s, p, rx?, ry?}: rotateX, then rotateY, then translate — the builder's order) as a loadModel()
 * result: the fit box is the kind's PROP_DEFS box (so applyTransform keeps the authored frame), `name` = `<kind>/<material>`.
 */
function partsModel(kind, parts, def, accent) {
  const tris = [];
  const rgb = hex => [((hex >> 16) & 255) / 200, ((hex >> 8) & 255) / 200, (hex & 255) / 200, 1];
  for (const part of parts) {
    const [sx, sy, sz] = part.s.map(v => v / 2), cx = Math.cos(part.rx ?? 0), snx = Math.sin(part.rx ?? 0), cy = Math.cos(part.ry ?? 0), sny = Math.sin(part.ry ?? 0);
    const xf = ([x, y, z]) => {
      const y1 = y * cx - z * snx, z1 = y * snx + z * cx; // rotateX
      const x2 = x * cy + z1 * sny, z2 = -x * sny + z1 * cy; // rotateY
      return [x2 + part.p[0], y1 + part.p[1], z2 + part.p[2]];
    };
    const v = [];
    for (const x of [-sx, sx]) for (const y of [-sy, sy]) for (const z of [-sz, sz]) v.push(xf([x, y, z]));
    const bc = rgb(part.m === 'accent' ? accent : PART_RGB[part.m] ?? 0x9a9a9a);
    // 6 faces (corner index = 4 * xi + 2 * yi + zi)
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      tris.push({p: [v[a], v[b], v[c]], uv: null, img: null, bc, blend: false, name: `${kind}/${part.m}`});
      tris.push({p: [v[a], v[c], v[d]], uv: null, img: null, bc, blend: false, name: `${kind}/${part.m}`});
    }
  }
  return {file: `procedural:${kind}`, tris, fitBox: {min: [-def.w / 2, 0, -def.d / 2], max: [def.w / 2, def.h, def.d / 2]}};
}

/** Kind sets for --batch / --list. */
export async function kindSet(name) {
  const rt = await loadRuntime();
  if (name === 'office' || name === 'base' || name === 'company') {
    const company = new Set(rt.COMPANY_KINDS);
    const kinds = name === 'office' ? ['desk', ...rt.OFFICE_KINDS] : name === 'base' ? ['desk', ...rt.OFFICE_KINDS.filter(k => !company.has(k))] : [...rt.COMPANY_KINDS];
    return kinds;
  }
  return name.split(',').map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// GLB loading (triangles with node transforms, base colour texture, names) and the runtime transform

const texCache = new WeakMap();
async function decodeTexture(tex) {
  if (!tex) return null;
  if (texCache.has(tex)) return texCache.get(tex);
  let out = null;
  try {
    const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha()
      .resize({width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true}).raw().toBuffer({resolveWithObject: true});
    out = {data, w: info.width, h: info.height};
  } catch { out = null; }
  texCache.set(tex, out);
  return out;
}

/**
 * Loads a GLB: world-space triangles {p: [a, b, c], uv, img, bc, blend, name} and the three.js-style fit box (each primitive's local
 * AABB through its node's world matrix, as Box3.setFromObject computes it for the game's fit).
 */
export async function loadModel(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
  const doc = await io.read(file);
  const tris = [];
  const fmin = [Infinity, Infinity, Infinity], fmax = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0], t = [0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    const xf = q => [M[0] * q[0] + M[4] * q[1] + M[8] * q[2] + M[12], M[1] * q[0] + M[5] * q[1] + M[9] * q[2] + M[13], M[2] * q[0] + M[6] * q[1] + M[10] * q[2] + M[14]];
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES only
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
      const mat = prim.getMaterial();
      const img = await decodeTexture(mat?.getBaseColorTexture() ?? null);
      const bc = mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const blend = mat?.getAlphaMode() === 'BLEND';
      const name = [node.getName(), mesh.getName(), mat?.getName()].filter(Boolean).join('/');
      const P = [], U = [];
      const lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) { lmin[k] = Math.min(lmin[k], v[k]); lmax[k] = Math.max(lmax[k], v[k]); }
        P.push(xf(v));
        if (uv) { uv.getElement(i, t); U.push([t[0], t[1]]); }
      }
      for (const cx of [lmin[0], lmax[0]]) for (const cy of [lmin[1], lmax[1]]) for (const cz of [lmin[2], lmax[2]]) {
        const c = xf([cx, cy, cz]);
        for (let k = 0; k < 3; k++) { fmin[k] = Math.min(fmin[k], c[k]); fmax[k] = Math.max(fmax[k], c[k]); }
      }
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        const a = idx ? idx.getScalar(i) : i, b = idx ? idx.getScalar(i + 1) : i + 1, c = idx ? idx.getScalar(i + 2) : i + 2;
        tris.push({p: [P[a], P[b], P[c]], uv: uv ? [U[a], U[b], U[c]] : null, img, bc, blend, name});
      }
    }
  }
  if (!tris.length) throw new Error(`${file}: no triangles`);
  return {file, tris, fitBox: {min: fmin, max: fmax}};
}

/**
 * Runtime transform: centre x / z and ground (min y = 0) on the fit box, scale (box fit, office uniform fit or explicit), optional
 * half turn about Y, optional lift. Returns new triangles + the resolved scale.
 */
export function applyTransform(model, o = {}) {
  const {min, max} = model.fitBox;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const c = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  let s = [1, 1, 1], fitNote = 'as authored';
  if (o.fit?.type === 'box') { s = [o.fit.w / size[0], o.fit.h / size[1], o.fit.d / size[2]]; fitNote = `box fit ${fmt3([o.fit.w, o.fit.h, o.fit.d])}`; }
  else if (o.fit?.type === 'uniform-wd') {
    const k = Math.min(o.fit.w / size[0], o.fit.d / size[2]);
    if (k > 0 && Number.isFinite(k)) { s = [k, k, k]; fitNote = `uniform k = min(${o.fit.w}/${r4(size[0])}, ${o.fit.d}/${r4(size[2])})`; }
  }
  if (o.scale) { const q = o.scale.length === 1 ? [o.scale[0], o.scale[0], o.scale[0]] : o.scale; s = [s[0] * q[0], s[1] * q[1], s[2] * q[2]]; fitNote += ` x scale ${o.scale.join(',')}`; }
  const f = o.turn ? -1 : 1, lift = o.lift || 0;
  const tx = q => [f * s[0] * (q[0] - c[0]), s[1] * (q[1] - c[1]) + lift, f * s[2] * (q[2] - c[2])];
  const tris = model.tris.map(t => ({...t, p: t.p.map(tx)}));
  return {tris, scale: s, turn: !!o.turn, lift, fileSize: size, fitNote};
}

// ---------------------------------------------------------------------------------------------
// Furniture-only body: clip at a height and / or exclude named parts

function lerpV(a, b, k) { return {p: a.p.map((x, i) => x + (b.p[i] - x) * k), uv: a.uv && b.uv ? a.uv.map((x, i) => x + (b.uv[i] - x) * k) : null}; }
function clipPoly(vs, Y, keepBelow) {
  const out = [];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    const ina = keepBelow ? a.p[1] <= Y : a.p[1] >= Y, inb = keepBelow ? b.p[1] <= Y : b.p[1] >= Y;
    if (ina) out.push(a);
    if (ina !== inb) out.push(lerpV(a, b, (Y - a.p[1]) / (b.p[1] - a.p[1])));
  }
  return out;
}
function fan(t, poly) {
  const out = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push({...t, p: [poly[0].p, poly[i].p, poly[i + 1].p], uv: t.uv ? [poly[0].uv, poly[i].uv, poly[i + 1].uv] : null});
  return out;
}
/** Splits triangles into {body, loose}: loose = matching `exclude` names, or the part above `below` (clipped exactly). */
export function splitBody(tris, {below = null, exclude = null} = {}) {
  const body = [], loose = [];
  const re = exclude ? new RegExp(exclude, 'i') : null;
  for (const t of tris) {
    if (re && re.test(t.name)) { loose.push(t); continue; }
    if (below === null) { body.push(t); continue; }
    const ys = t.p.map(q => q[1]);
    if (Math.max(...ys) <= below) { body.push(t); continue; }
    if (Math.min(...ys) >= below) { loose.push(t); continue; }
    const vs = t.p.map((p, i) => ({p, uv: t.uv ? t.uv[i] : null}));
    body.push(...fan(t, clipPoly(vs, below, true)));
    loose.push(...fan(t, clipPoly(vs, below, false)));
  }
  return {body, loose};
}

// ---------------------------------------------------------------------------------------------
// Measurements

export function boundsOf(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const q of t.p) for (let k = 0; k < 3; k++) { if (q[k] < min[k]) min[k] = q[k]; if (q[k] > max[k]) max[k] = q[k]; }
  return {min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]};
}

/**
 * Grounded contact: geometry within CONTACT_BAND of the lowest point, clustered on a 5 cm x / z grid; the floor gap; and `baseY`,
 * the lowest height at which the near-floor geometry spans >= 25 % of the footprint (a lowest point that is only a speck — stray
 * geometry, a hanging strap — is flagged).
 */
export function contactOf(tris, floor = 0) {
  const b = boundsOf(tris);
  const minY = b.min[1];
  const verts = [];
  const seen = new Set();
  for (const t of tris) for (const q of t.p) {
    if (q[1] > minY + 0.3) continue;
    const key = `${q[0].toFixed(4)},${q[1].toFixed(4)},${q[2].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verts.push(q);
  }
  verts.sort((a, c) => a[1] - c[1]);
  const near = verts.filter(q => q[1] <= minY + CONTACT_BAND);
  // clusters (5 cm cells, 8-neighbour union)
  const cell = 0.05, cells = new Map();
  for (const q of near) {
    const k = `${Math.floor(q[0] / cell)},${Math.floor(q[2] / cell)}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = {i: Math.floor(q[0] / cell), j: Math.floor(q[2] / cell), pts: []}));
    c.pts.push(q);
  }
  const keys = [...cells.keys()], parent = new Map(keys.map(k => [k, k]));
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const [k, c] of cells) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const n = `${c.i + di},${c.j + dj}`;
    if (cells.has(n)) parent.set(find(k), find(n));
  }
  const groups = new Map();
  for (const [k, c] of cells) { const r = find(k); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(...c.pts); }
  const clusters = [...groups.values()].map(pts => {
    const xs = pts.map(q => q[0]), zs = pts.map(q => q[2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return {x: r3((x0 + x1) / 2), z: r3((z0 + z1) / 2), w: r3(x1 - x0), d: r3(z1 - z0), verts: pts.length};
  }).sort((a, c) => c.verts - a.verts);
  // base: lowest band that spans a real part of the footprint
  let baseY = minY;
  const W = b.size[0], D = b.size[2];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of verts) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
    if (x1 - x0 >= 0.25 * W || z1 - z0 >= 0.25 * D) { baseY = q[1]; break; }
  }
  const gap = minY - floor;
  const state = Math.abs(gap) <= 0.005 ? 'grounded' : gap > 0 ? `FLOATING ${r3(gap)} m above the floor` : `SUNK ${r3(-gap)} m below the floor`;
  const out = {floor, minY: r4(minY), gap: r4(gap), state, clusters: clusters.slice(0, 12), clusterCount: clusters.length,
    contactSpan: near.length ? {w: r3(Math.max(...near.map(q => q[0])) - Math.min(...near.map(q => q[0]))), d: r3(Math.max(...near.map(q => q[2])) - Math.min(...near.map(q => q[2])))} : null,
    baseY: r4(baseY)};
  if (baseY - minY > 0.01) out.warning = `lowest point (${r3(minY)}) is a speck: the broad base starts ${r3(baseY - minY)} m higher — stray geometry or a dangling part?`;
  return out;
}

/** Top-down height map (max y per cell) -> horizontal plateaus by area. */
export function surfacesOf(tris) {
  const b = boundsOf(tris);
  const W = b.size[0], D = b.size[2];
  const res = Math.max(0.01, Math.sqrt((W * D) / 250_000));
  const nx = Math.max(1, Math.ceil(W / res)), nz = Math.max(1, Math.ceil(D / res));
  const top = new Float32Array(nx * nz).fill(-Infinity);
  for (const t of tris) {
    const s = t.p.map(q => [(q[0] - b.min[0]) / res, (q[2] - b.min[2]) / res, q[1]]);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), i1 = Math.min(nx - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const j0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), j1 = Math.min(nz - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i + 0.5, y = j + 0.5;
      const b0 = ((s[1][0] - x) * (s[2][1] - y) - (s[2][0] - x) * (s[1][1] - y)) / area;
      const b1 = ((s[2][0] - x) * (s[0][1] - y) - (s[0][0] - x) * (s[2][1] - y)) / area;
      const b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const h = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2];
      const k = j * nx + i;
      if (h > top[k]) top[k] = h;
    }
  }
  const hist = new Map();
  let covered = 0;
  for (const h of top) if (h > -Infinity) { covered++; const bin = Math.round(h / 0.01); hist.set(bin, (hist.get(bin) || 0) + 1); }
  if (!covered) return {plateaus: [], topSurface: null, coveredM2: 0};
  const bins = [...hist.entries()].filter(([, n]) => n >= 0.03 * covered).sort((a, c) => a[0] - c[0]);
  const plateaus = [];
  for (const [bin, n] of bins) {
    const last = plateaus[plateaus.length - 1];
    if (last && bin - last.hi <= 2) { last.sum += bin * n; last.n += n; last.hi = bin; } else plateaus.push({lo: bin, hi: bin, sum: bin * n, n});
  }
  const cellA = res * res;
  const out = plateaus.map(p => ({y: r3((p.sum / p.n) * 0.01), areaM2: r3(p.n * cellA), share: r3(p.n / covered)})).sort((a, c) => c.share - a.share).slice(0, 5);
  const broad = out.filter(p => p.share >= 0.08 && p.y > 0.03);
  // topSurface = the highest broad plateau (a hutch / shelf top when there is one); mainSurface = the largest one (usually the work top)
  return {plateaus: out, topSurface: broad.length ? broad.reduce((a, c) => (c.y > a.y ? c : a)) : null, mainSurface: broad[0] ?? null,
    coveredM2: r3(covered * cellA), resolution: r3(res)};
}

// ---------------------------------------------------------------------------------------------
// Rendering: FRONT (camera +Z) and SIDE (camera +X) panels side by side on one ground line, 0.1 m grid, 0.5 m labelled ticks

const VIEWS = {
  front: {title: 'FRONT (camera on +Z, looking at the prop front)', u: q => q[0], d: q => q[2], range: b => [b.min[0], b.max[0]]},
  side: {title: 'SIDE (camera on +X; prop front +Z at LEFT)', u: q => -q[2], d: q => q[0], range: b => [-b.max[2], -b.min[2]]},
};
const LIGHT = (() => { const l = [-0.35, 0.6, 0.72], n = Math.hypot(...l); return l.map(x => x / n); })();

function rasterize(img, zb, W, H, tris, view, toPx, tint, alphaPass) {
  const step = tris.length > RENDER_TRI_CAP ? Math.ceil(tris.length / RENDER_TRI_CAP) : 1;
  for (let ti = 0; ti < tris.length; ti += step) {
    const t = tris[ti];
    if (!!t.blend !== alphaPass) continue;
    const w = t.p.map(q => [view.u(q), q[1], view.d(q)]);
    const e1 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]], e2 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.35 + 0.65 * Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const s = w.map(toPx);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const alpha = alphaPass ? Math.min(0.7, Math.max(0.3, t.bc[3] ?? 0.5)) : 1;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5, y = py + 0.5;
      const b0 = ((s[1][0] - x) * (s[2][1] - y) - (s[2][0] - x) * (s[1][1] - y)) / area;
      const b1 = ((s[2][0] - x) * (s[0][1] - y) - (s[0][0] - x) * (s[2][1] - y)) / area;
      const b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const z = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2];
      const k = py * W + px;
      if (z <= zb[k]) continue;
      if (!alphaPass) zb[k] = z;
      let r = 200 * t.bc[0], g = 200 * t.bc[1], bl = 200 * t.bc[2];
      if (t.img && t.uv) {
        const uu = b0 * t.uv[0][0] + b1 * t.uv[1][0] + b2 * t.uv[2][0], vv = b0 * t.uv[0][1] + b1 * t.uv[1][1] + b2 * t.uv[2][1];
        const tx = Math.min(t.img.w - 1, Math.max(0, Math.floor((uu - Math.floor(uu)) * t.img.w)));
        const ty = Math.min(t.img.h - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * t.img.h)));
        const o = (ty * t.img.w + tx) * 3;
        r = t.img.data[o] * t.bc[0]; g = t.img.data[o + 1] * t.bc[1]; bl = t.img.data[o + 2] * t.bc[2];
      }
      r *= shade; g *= shade; bl *= shade;
      if (tint) { r = r * 0.45 + tint[0] * 0.55; g = g * 0.45 + tint[1] * 0.55; bl = bl * 0.45 + tint[2] * 0.55; }
      const o = k * 3;
      img[o] = Math.min(255, img[o] * (1 - alpha) + r * alpha);
      img[o + 1] = Math.min(255, img[o + 1] * (1 - alpha) + g * alpha);
      img[o + 2] = Math.min(255, img[o + 2] * (1 - alpha) + bl * alpha);
    }
  }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * objects: [{label, lines: [text], side: text, body, loose, full (bounds), bb (body bounds), plates ([{y, share}] marked), contact}]
 * Returns {file, width, height, ppm}.
 */
export async function renderSheet(objects, out, {ppm = 200, maxWidth = 4200, refs = true, title = ''} = {}) {
  const GAP = 0.35, MARGIN = 0.45, CH = 7.2, FONT = 13, LINE = 16;
  const lineCount = Math.max(...objects.map(o => o.lines.length)) + 1;
  const layout = p => {
    const cols = {};
    for (const vn of Object.keys(VIEWS)) {
      let cursor = MARGIN;
      cols[vn] = objects.map(o => {
        const [u0, u1] = VIEWS[vn].range(o.full);
        const textW = (vn === 'front' ? Math.max(...o.lines.map(l => l.length), o.label.length) : o.side.length) * CH / p;
        const colW = Math.max(u1 - u0, textW) + GAP;
        const off = cursor + (colW - (u1 - u0)) / 2 - u0; // centre the object in its column
        const c = {x0: cursor, x1: cursor + colW, off};
        cursor += colW;
        return c;
      });
      cols[vn].width = cursor + 0.25;
    }
    return cols;
  };
  let cols = layout(ppm);
  const totalM = () => cols.front.width + cols.side.width;
  for (let i = 0; i < 6 && totalM() * ppm > maxWidth; i++) { ppm = Math.max(50, Math.floor(maxWidth / totalM())); cols = layout(ppm); }
  const topM = Math.max(2.1, ...objects.map(o => o.full.max[1])) + 0.3;
  const W = Math.ceil(totalM() * ppm), labelH = lineCount * LINE + 24, narrow = W < 2600, titleH = narrow ? 46 : 30;
  const groundPx = titleH + Math.ceil(topM * ppm);
  const H = groundPx + labelH;
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = 30; img[i * 3 + 1] = 32; img[i * 3 + 2] = 37; }
  const zb = new Float32Array(W * H).fill(-Infinity);
  const panelX = {front: 0, side: Math.ceil(cols.front.width * ppm)};
  const blendPx = (x, y, col, a) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - a) + col[k] * a; };
  // grid (background): 0.1 m faint, 0.5 m stronger, ground line
  for (const vn of Object.keys(VIEWS)) {
    const px0 = panelX[vn], pw = Math.floor(cols[vn].width * ppm);
    for (let g = 0; g * 0.1 <= cols[vn].width; g++) {
      const x = px0 + Math.round(g * 0.1 * ppm), strong = g % 5 === 0;
      for (let y = titleH; y < groundPx; y++) blendPx(x, y, strong ? [95, 100, 115] : [60, 63, 72], strong ? 0.8 : 0.6);
    }
    for (let g = 0; g * 0.1 <= topM; g++) {
      const y = groundPx - Math.round(g * 0.1 * ppm), strong = g % 5 === 0;
      for (let x = px0; x < px0 + pw; x++) blendPx(x, y, strong ? [95, 100, 115] : [60, 63, 72], strong ? 0.8 : 0.6);
    }
  }
  // geometry
  objects.forEach((o, i) => {
    for (const vn of Object.keys(VIEWS)) {
      const c = cols[vn][i];
      const toPx = q => [panelX[vn] + (q[0] + c.off) * ppm, groundPx - q[1] * ppm, q[2]];
      for (const alphaPass of [false, true]) {
        rasterize(img, zb, W, H, o.body, VIEWS[vn], toPx, null, alphaPass);
        if (o.loose?.length) rasterize(img, zb, W, H, o.loose, VIEWS[vn], toPx, [255, 70, 210], alphaPass);
      }
    }
  });
  // ground line on top of geometry feet (2 px)
  for (let x = 0; x < W; x++) { blendPx(x, groundPx, [235, 235, 235], 1); blendPx(x, groundPx + 1, [235, 235, 235], 1); }
  // vector overlay: titles, tick labels, reference lines, bounds boxes, top-surface markers, contacts, labels
  const svg = [];
  const text = (x, y, s, {size = FONT, fill = '#e8e8e8', anchor = 'start', weight = 'normal'} = {}) =>
    svg.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
  const line = (x0, y0, x1, y1, stroke, w = 1, dash = '') => svg.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  const rect = (x0, y0, x1, y1, stroke, dash = '') => svg.push(`<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  text(8, 20, title || 'scale check — props beside a runtime-scaled standing zombie', {size: 15, weight: 'bold'});
  text(narrow ? 8 : W - 8, narrow ? 38 : 20, `${ppm} px/m · grid 0.1 m · ticks 0.5 m · magenta = excluded loose parts · cyan = furniture-only bounds · yellow = horizontal surfaces (share of top-down area) · red = floor contact`, {size: narrow ? 11 : 12, anchor: narrow ? 'start' : 'end', fill: '#bbbbbb'});
  for (const vn of Object.keys(VIEWS)) {
    const px0 = panelX[vn], pw = cols[vn].width * ppm;
    text(px0 + 8, titleH + 16, VIEWS[vn].title, {size: 13, fill: '#9fd3ff', weight: 'bold'});
    if (vn === 'side') line(px0, titleH, px0, H, '#d0d0d0', 2);
    for (let g = 1; g * 0.5 <= topM - 0.05; g++) {
      const y = groundPx - g * 0.5 * ppm;
      line(px0, y, px0 + 14, y, '#ffffff', 2);
      text(px0 + 17, y + 4, `${(g * 0.5).toFixed(1)} m`, {size: 12, fill: '#ffffff'});
    }
    text(px0 + 17, groundPx - 4, '0', {size: 12, fill: '#ffffff'});
    if (refs) for (const [y, l] of REFS) {
      if (y > topM) continue;
      line(px0 + 60, groundPx - y * ppm, px0 + pw - 4, groundPx - y * ppm, 'rgba(120,230,200,0.55)', 1, '6 6');
      text(px0 + pw - 6, groundPx - y * ppm - 3, l, {size: 10, fill: 'rgba(150,240,210,0.9)', anchor: 'end'});
    }
  }
  objects.forEach((o, i) => {
    for (const vn of Object.keys(VIEWS)) {
      const c = cols[vn][i], V = VIEWS[vn], px0 = panelX[vn];
      const U = u => px0 + (u + c.off) * ppm, Y = y => groundPx - y * ppm;
      const [fu0, fu1] = V.range(o.full);
      if (o.bb) {
        const [bu0, bu1] = V.range(o.bb);
        rect(U(bu0), Y(o.bb.min[1]), U(bu1), Y(o.bb.max[1]), '#38e0ff');
        rect(U(fu0), Y(o.full.min[1]), U(fu1), Y(o.full.max[1]), 'rgba(255,90,220,0.8)', '4 3');
      }
      for (const pl of o.plates ?? []) {
        line(U(fu0) - 6, Y(pl.y), U(fu1) + 6, Y(pl.y), '#ffd84a', 2);
        if (vn === 'front') text(U(fu1) + 8, Y(pl.y) + 4, `${pl.y.toFixed(2)} (${Math.round(pl.share * 100)}%)`, {size: 11, fill: '#ffd84a'});
      }
      if (o.contact) for (const cl of o.contact.clusters) {
        const [a, b] = vn === 'front' ? [cl.x - cl.w / 2, cl.x + cl.w / 2] : [-(cl.z + cl.d / 2), -(cl.z - cl.d / 2)];
        line(U(a) - 1, Y(o.contact.minY) + 4, U(b) + 1, Y(o.contact.minY) + 4, '#ff4040', 4);
      }
      const cx = (c.x0 + c.x1) / 2;
      if (vn === 'front') o.lines.forEach((l, k) => text(px0 + cx * ppm, groundPx + 22 + k * LINE, l, {size: k ? 12 : 13, anchor: 'middle', weight: k ? 'normal' : 'bold', fill: k ? '#dddddd' : '#ffffff'}));
      else text(px0 + cx * ppm, groundPx + 22, o.side, {size: 12, anchor: 'middle', fill: '#dddddd'});
    }
  });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  await sharp(img, {raw: {width: W, height: H, channels: 3}}).composite([{input: overlay, top: 0, left: 0}]).png().toFile(out);
  return {file: out, width: W, height: H, ppm};
}

// ---------------------------------------------------------------------------------------------
// Props + zombie -> report + sheet

const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 10000) / 10000;
const fmt3 = a => a.map(v => v.toFixed(2)).join('×');
const relRepo = f => (f && f.startsWith(ROOT) ? path.relative(ROOT, f) : f);

export async function loadZombie(id = 'lastshift', scale = 1) {
  if (!ZOMBIE_IDS.includes(id)) throw new Error(`unknown zombie '${id}' (${ZOMBIE_IDS.join(', ')})`);
  if (!(scale >= 0.95 && scale <= 1.05)) throw new Error(`--zombie-scale ${scale}: the game spawns zombies at 0.95 .. 1.05 (ai/zombieActor.ts); never rescale the reference to flatter a prop`);
  const file = path.join(PUBLIC, `assets/models/zombie-body-${id}-t25.glb`);
  const side = JSON.parse(fs.readFileSync(path.join(PUBLIC, `assets/derivatives/zombie-body-${id}.json`), 'utf8'));
  const heightM = side.profile?.heightM ?? side.conventions?.heightM;
  const m = await loadModel(file);
  // the bind mesh is authored at heightM with the feet midpoint at the origin: only the runtime root scale applies
  const tris = m.tris.map(t => ({...t, p: t.p.map(q => [q[0] * scale, q[1] * scale, q[2] * scale])}));
  const b = boundsOf(tris);
  return {id, file, heightM, scale, tris, bounds: b};
}

/** Resolves one prop spec ({kind?, file?, model?, fit?, scale?, turn?, lift?, below?, exclude?, floor?, label?}) to a measured object. */
export async function measureProp(spec) {
  let base = {};
  if (spec.kind) {
    base = await resolveKind(spec.kind);
    if (!base.file && !spec.model) return {label: spec.label ?? spec.kind, kind: spec.kind, skipped: base.path};
  }
  const file = spec.model ?? spec.file ?? base.file;
  // (lane CACHE, R5) an authored procedural purpose shape: its box parts, unless a --model GLB is swapped in
  const model = base.parts && !spec.model ? partsModel(spec.kind, base.parts, base.def, base.accent) : await loadModel(path.resolve(file));
  const o = {
    fit: spec.fit ?? base.fit ?? null, scale: spec.scale ?? null,
    turn: spec.turn ?? base.turn ?? false, lift: spec.lift ?? base.lift ?? 0,
  };
  const x = applyTransform(model, o);
  const {body, loose} = (spec.below != null || spec.exclude) ? splitBody(x.tris, {below: spec.below ?? null, exclude: spec.exclude ?? null}) : {body: x.tris, loose: []};
  if (!body.length) throw new Error(`${file}: the furniture-only body is empty (check --below / --exclude)`);
  const full = boundsOf(x.tris), bb = boundsOf(body);
  const floor = spec.floor ?? x.lift ?? 0;
  const contact = contactOf(body, floor);
  const surf = surfacesOf(body);
  const surfFull = loose.length ? surfacesOf(x.tris) : null;
  const warnings = [];
  const [sx, sy, sz] = x.scale;
  if (Math.max(sx, sy, sz) / Math.min(sx, sy, sz) > 1.02) warnings.push(`non-uniform runtime fit ${x.scale.map(v => v.toFixed(3)).join(',')}: the model is stretched`);
  if (base.def && o.fit?.type === 'uniform-wd') {
    const hDiff = full.max[1] - base.def.h; // the water tower's lift is part of its footprint height
    if (Math.abs(hDiff) > 0.02) warnings.push(`rendered top ${r3(full.max[1])} m != PROP_DEFS h ${base.def.h} (collision / placement box)`);
  }
  if (contact.warning) warnings.push(contact.warning);
  if (!contact.state.startsWith('grounded')) warnings.push(contact.state);
  return {
    label: spec.label ?? spec.kind ?? path.basename(file, '.glb'), kind: spec.kind ?? null, file: relRepo(path.resolve(file)),
    path: spec.kind ? base.path + (spec.model ? ' [model swapped]' : '') : 'explicit', modelKey: base.modelKey ?? null,
    def: base.def ? {w: base.def.w, h: base.def.h, d: base.def.d} : null,
    fileSize: x.fileSize.map(r4), fit: o.fit, fitNote: x.fitNote, scale: x.scale.map(r4), turn: x.turn, lift: x.lift,
    size: full.size.map(r3), bounds: {min: full.min.map(r3), max: full.max.map(r3)},
    body: loose.length ? {rule: spec.exclude ? `exclude /${spec.exclude}/` + (spec.below != null ? ` + below ${spec.below}` : '') : `below y ${spec.below}`,
      size: bb.size.map(r3), bounds: {min: bb.min.map(r3), max: bb.max.map(r3)}, looseTris: loose.length} : null,
    contact, surfaces: surf.plateaus, topSurface: surf.topSurface, mainSurface: surf.mainSurface, surfacesWithLoose: surfFull?.plateaus ?? null,
    tris: model.tris.length, notes: base.notes ?? [], warnings,
    _render: {body, loose, full, bb: loose.length ? bb : null},
  };
}

function objectFor(p) {
  const s = p.body ? p.body.size : p.size;
  const lines = [p.label, `${fmt3(p.size)} m (W×H×D)`];
  if (p.body) lines.push(`body ${fmt3(s)} (${p.body.rule})`);
  lines.push(`${p.contact.state.startsWith('grounded') ? 'grounded' : p.contact.state} · ${p.contact.clusterCount} contact${p.contact.clusterCount === 1 ? '' : 's'}`
    + (p.mainSurface ? ` · surface ${p.mainSurface.y.toFixed(2)}` : '') + (p.topSurface && p.topSurface !== p.mainSurface && p.topSurface.y !== p.mainSurface?.y ? ` / top ${p.topSurface.y.toFixed(2)}` : ''));
  lines.push(`scale ${p.scale.every(v => Math.abs(v - p.scale[0]) < 1e-4) ? p.scale[0].toFixed(3) : p.scale.map(v => v.toFixed(3)).join(',')}${p.turn ? ' · turned' : ''}`);
  return {label: p.label, lines, side: p.label, body: p._render.body, loose: p._render.loose, full: p._render.full, bb: p._render.bb,
    plates: p.surfaces.filter(s => s.share >= 0.1 && s.y > 0.03).slice(0, 3), contact: p.contact};
}

export async function scaleCheck(specs, {out, json, zombie = 'lastshift', zombieScale = 1, ppm = 200, maxWidth = 4200, refs = true, quiet = false} = {}) {
  const z = await loadZombie(zombie, zombieScale);
  const props = [];
  for (const s of specs) props.push(await measureProp(s));
  const drawn = props.filter(p => !p.skipped);
  const zobj = {label: `zombie ${z.id}`, lines: [`zombie ${z.id} (reference)`, `${z.heightM.toFixed(2)} m tall · runtime scale ${z.scale.toFixed(2)}`, `A-pose bind mesh, ${fmt3(z.bounds.size)}`],
    side: `zombie ${z.id}`, body: z.tris, loose: [], full: z.bounds, bb: null, plates: [], contact: null};
  const names = drawn.map(p => p.label).join('+') || 'none';
  out = out ?? path.join(ROOT, 'qa-artifacts/scale-check', `${names.replace(/[^\w+.-]+/g, '_').slice(0, 120)}.png`);
  const sheet = drawn.length ? await renderSheet([zobj, ...drawn.map(objectFor)], out, {ppm, maxWidth, refs, title: `scale check — ${names} beside zombie ${z.id} (${z.heightM} m × ${z.scale})`}) : null;
  const report = {
    tool: 'tools/asset-pipeline/props/scale-check.mjs', task: 'office-props-physics-scale-20261030 (lane SCALE)',
    image: sheet ? relRepo(path.resolve(sheet.file)) : null, ppm: sheet?.ppm ?? null,
    zombie: {id: z.id, file: relRepo(z.file), heightM: z.heightM, runtimeScale: z.scale, size: z.bounds.size.map(r3)},
    props: props.map(p => { const {_render, ...rest} = p; void _render; return rest; }),
  };
  json = json ?? (sheet ? sheet.file.replace(/\.png$/i, '.json') : null);
  if (json) { fs.mkdirSync(path.dirname(json), {recursive: true}); fs.writeFileSync(json, JSON.stringify(report, null, 1) + '\n'); }
  if (!quiet) printReport(report, json);
  return report;
}

function printReport(r, json) {
  console.log(`zombie ${r.zombie.id}: ${r.zombie.heightM} m × runtime scale ${r.zombie.runtimeScale}`);
  for (const p of r.props) {
    if (p.skipped) { console.log(`- ${p.label}: SKIPPED — ${p.skipped}`); continue; }
    console.log(`- ${p.label}  [${p.path}]  ${p.file}`);
    console.log(`    scale ${p.scale.join(',')}${p.turn ? ' turned' : ''}${p.lift ? ` lift ${p.lift}` : ''}  (${p.fitNote})${p.def ? `  PROP_DEFS w ${p.def.w} h ${p.def.h} d ${p.def.d}` : ''}`);
    console.log(`    W×H×D ${p.size.join(' × ')} m` + (p.body ? `   furniture-only body ${p.body.size.join(' × ')} m (${p.body.rule})` : ''));
    console.log(`    contact: min-y ${p.contact.minY}  ${p.contact.state}  ${p.contact.clusterCount} cluster(s), span ${p.contact.contactSpan ? `${p.contact.contactSpan.w}×${p.contact.contactSpan.d}` : '-'}  base-y ${p.contact.baseY}`);
    console.log(`    surfaces: ${p.surfaces.map(s => `${s.y} m (${Math.round(s.share * 100)}%)`).join(', ') || '-'}  → main ${p.mainSurface ? `${p.mainSurface.y} m` : '-'}, highest broad ${p.topSurface ? `${p.topSurface.y} m` : '-'}`);
    for (const w of [...p.notes.map(n => `note: ${n}`), ...p.warnings.map(w => `WARN: ${w}`)]) console.log(`    ${w}`);
  }
  if (r.image) console.log(`image ${r.image}`);
  if (json) console.log(`json  ${relRepo(path.resolve(json))}`);
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const g = {specs: [], refs: true, per: 4};
  const nums = s => s.split(',').map(Number);
  let cur = null;
  const need = (i, flag) => { if (i >= argv.length) throw new Error(`${flag} needs a value`); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => need(++i, a);
    const prop = () => { if (!cur) throw new Error(`${a} must follow --kind or --prop`); return cur; };
    switch (a) {
      case '--kind': g.specs.push(cur = {kind: val()}); break;
      case '--prop': case '--glb': g.specs.push(cur = {file: val()}); break;
      case '--model': prop().model = val(); break;
      case '--fit': { const [w, h, d] = nums(val()); prop().fit = {type: 'box', w, h, d}; break; }
      case '--fit-wd': { const [w, d] = nums(val()); prop().fit = {type: 'uniform-wd', w, d}; break; }
      case '--scale': prop().scale = nums(val()); break;
      case '--turn': prop().turn = true; break;
      case '--no-turn': prop().turn = false; break;
      case '--lift': prop().lift = +val(); break;
      case '--below': prop().below = +val(); break;
      case '--exclude': prop().exclude = val(); break;
      case '--floor': prop().floor = +val(); break;
      case '--label': prop().label = val(); break;
      case '--out': g.out = val(); break;
      case '--json': g.json = val(); break;
      case '--zombie': g.zombie = val(); break;
      case '--zombie-scale': g.zombieScale = +val(); break;
      case '--ppm': g.ppm = +val(); break;
      case '--max-width': g.maxWidth = +val(); break;
      case '--no-refs': g.refs = false; break;
      case '--batch': g.batch = val(); break;
      case '--per': g.per = Math.max(1, +val()); break;
      case '--list': g.list = val(); break;
      case '--quiet': g.quiet = true; break;
      case '-h': case '--help': g.help = true; break;
      default: throw new Error(`unknown argument ${a} (see --help)`);
    }
  }
  return g;
}

async function main() {
  const g = parseArgs(process.argv.slice(2));
  if (g.help || (!g.specs.length && !g.batch && !g.list)) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(src.slice(src.findIndex(l => l.startsWith('// usage:')), src.findIndex(l => l.startsWith('// Report'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const opts = {zombie: g.zombie ?? 'lastshift', zombieScale: g.zombieScale ?? 1, ppm: g.ppm ?? 200, maxWidth: g.maxWidth ?? 4200, refs: g.refs, quiet: g.quiet};
  if (g.list) {
    for (const k of await kindSet(g.list)) {
      const r = await resolveKind(k).catch(e => ({file: null, path: e.message}));
      console.log(`${k.padEnd(22)} ${r.file ? relRepo(r.file).padEnd(52) : '-'.padEnd(52)} ${r.path}${r.fit ? `  fit ${r.fit.type} ${[r.fit.w, r.fit.h, r.fit.d].filter(v => v != null).join(',')}` : ''}${r.turn ? ' turn' : ''}`);
    }
    return;
  }
  if (g.batch) {
    const kinds = await kindSet(g.batch);
    const prefix = g.out ? g.out.replace(/\.png$/i, '') : path.join(ROOT, 'qa-artifacts/scale-check/batch');
    const all = [];
    let sheet = 0;
    const resolved = [];
    for (const k of kinds) {
      const r = await resolveKind(k).catch(e => ({file: null, path: e.message}));
      if (r.file) resolved.push(k); else all.push({label: k, kind: k, skipped: r.path});
    }
    for (let i = 0; i < resolved.length; i += g.per) {
      const group = resolved.slice(i, i + g.per);
      const out = `${prefix}-${String(++sheet).padStart(2, '0')}-${group.join('+')}.png`;
      const rep = await scaleCheck(group.map(kind => ({kind})), {...opts, out, quiet: true});
      for (const p of rep.props) all.push({...p, image: rep.image});
      if (!g.quiet) console.log(`sheet ${rep.image}: ${group.join(', ')}`);
    }
    const json = g.json ?? `${prefix}.json`;
    const report = {tool: 'tools/asset-pipeline/props/scale-check.mjs', batch: g.batch, zombie: {id: opts.zombie, runtimeScale: opts.zombieScale}, props: all};
    fs.mkdirSync(path.dirname(json), {recursive: true});
    fs.writeFileSync(json, JSON.stringify(report, null, 1) + '\n');
    if (!g.quiet) printReport({zombie: {id: opts.zombie, heightM: '(see sheets)', runtimeScale: opts.zombieScale}, props: all, image: null}, json);
    return;
  }
  await scaleCheck(g.specs, {...opts, out: g.out, json: g.json});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(`scale-check: ${e.message}`); process.exit(1); });
}
