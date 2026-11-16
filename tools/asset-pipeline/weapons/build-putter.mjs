// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the runtime model of the mini-golf PUTTER — HAND-BUILT
// from code primitives (a tapered rubber grip, a ferrule, a steel shaft, a hosel and a flat blade head with a rubber face insert and a
// painted sight line). NO generation of any kind (no Meshy, Codex or other image / 3D service, no texture art): every vertex below comes
// from the dimensions in SPEC, every surface is a plain PBR material factor (no texture maps). The script itself is the master (it is
// deterministic: the same bytes on every run, checked by --check).
//
// Convention = the game's held-weapon frame (weapons/viewmodel.ts; the weapon-variety / flamethrower cooks): metres at real size, +Y up,
// the HEAD toward -Z (the shaft runs along Z: the grip end at +Z), the club's right side +X. The head's heel-toe axis runs along Y (the
// heel at the shaft, the toe toward -Y) and its striking FACE looks along +X (the side view from +X sees the face, the toe hanging down,
// like the HUD glyph). The bounding box is centred on the origin; empty marker nodes:
//   Grip = the upper hand on the grip (the held view pivots there), Tip = the centre of the striking face (the putt's contact point).
// Lying as a pickup (world/pickups.ts / weaponVarietyModels.ts lyingWeapon: model +X up) it rests flat on the back of its blade.
//
// Writes deterministically:
//   game/public/assets/models/weapon-putter.glb          one node per part + the two marker nodes, four plain materials
//   game/public/assets/derivatives/weapon-putter.json    public provenance (dimensions / hashes only)
//   game/src/assets/putterModel.generated.ts             PUTTER_MODEL (weapons/putter.ts, weapons/lazyWeaponModels.ts)
//   tools/release/public-inputs.json                     ONLY this script's two entries added / updated
// (assets/CREDITS.md already credits "simple pickup / trim geometry: authored for this project" in general; no section is added.)
//
//   node tools/asset-pipeline/weapons/build-putter.mjs [--check] [--dry-run <scratch dir>]
//   (--check: build in memory and fail when any written file differs; --dry-run: write the GLB + provenance + registry preview there only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const DRY = arg('--dry-run') ? path.resolve(arg('--dry-run')) : null;
const CHECK = argv.includes('--check');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/putterModel.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/weapons/build-putter.mjs';
const TASK = 'studio-skywalk-events-20261115-193624-01';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-putter: ${m}`); process.exit(1); };
const nz = v => (Object.is(v, -0) || Math.abs(v) < 5e-7 ? 0 : v);
const r5 = v => nz(+v.toFixed(5));

/**
 * The putter's real dimensions (m): a 35-inch (0.89 m) blade putter. Grip: a 0.265 m rubber grip tapering 29 -> 23 mm; ferrule; a
 * 11 mm steel shaft; a short hosel into the heel of a 102 x 25 x 25 mm milled blade (heel-toe x face-back x sole-top) with a rubber face
 * insert proud 1 mm and a white sight line on the top. Axes before centring: the grip end at z = +L / 2, the sole at z = -L / 2.
 */
const SPEC = {
  length: 0.89,
  grip: {z0: 0.18, z1: 0.445, r0: 0.0115, r1: 0.0145, seg: 16},
  ferrule: {z0: 0.168, z1: 0.18, r: 0.0072, seg: 12},
  shaft: {z0: -0.41, z1: 0.168, r: 0.0055, seg: 12},
  hosel: {z0: -0.4205, z1: -0.41, r: 0.0064, seg: 12},
  head: {x: [-0.0125, 0.0125], y: [-0.086, 0.016], z: [-0.445, -0.4205]},
  insert: {x: [0.0125, 0.0135], y: [-0.081, 0.011], z: [-0.4425, -0.423]},
  sight: {x: [-0.011, 0.011], y: [-0.0365, -0.0325], z: [-0.4205, -0.4199]},
  /** Marker points before centring: the upper hand on the grip; the centre of the striking face (on the insert). */
  markers: {Grip: [0, 0, 0.385], Tip: [0.0135, -0.035, -0.43275]},
};
/** Plain PBR factors (linear base colour): rubber, polished steel, satin milled steel, white paint. No texture maps. */
const MATS = {
  rubber: {color: [0.018, 0.018, 0.02, 1], metal: 0, rough: 0.82},
  steel: {color: [0.62, 0.64, 0.66, 1], metal: 0.55, rough: 0.3},
  satin: {color: [0.42, 0.43, 0.45, 1], metal: 0.5, rough: 0.48},
  paint: {color: [0.86, 0.86, 0.84, 1], metal: 0, rough: 0.6},
};
/** Parts: node name, material, shape. */
const PARTS = [
  ['putter-grip', 'rubber', 'grip'], ['putter-ferrule', 'rubber', 'ferrule'], ['putter-shaft', 'steel', 'shaft'], ['putter-hosel', 'steel', 'hosel'],
  ['putter-head', 'satin', 'head'], ['putter-insert', 'rubber', 'insert'], ['putter-sight', 'paint', 'sight'],
];

// ---------- primitive geometry (flat-shaded boxes, smooth-sided capped cylinders along Z) ----------
function box(b) {
  const P = [], N = [], I = [];
  const [x0, x1] = b.x, [y0, y1] = b.y, [z0, z1] = b.z;
  const face = (n, c) => { const s = P.length / 3; for (const p of c) { P.push(...p); N.push(...n); } I.push(s, s + 1, s + 2, s, s + 2, s + 3); };
  face([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  face([0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
  face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face([0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]);
  return {P, N, I};
}
function cylinder(c) {
  const P = [], N = [], I = [];
  const r0 = c.r0 ?? c.r, r1 = c.r1 ?? c.r, n = c.seg, slope = (r0 - r1) / (c.z1 - c.z0);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a), l = Math.hypot(1, slope);
    P.push(cx * r0, sy * r0, c.z0, cx * r1, sy * r1, c.z1);
    N.push(cx / l, sy / l, slope / l, cx / l, sy / l, slope / l);
  }
  for (let i = 0; i < n; i++) { const a = 2 * i, b = a + 1, d = a + 2, e = a + 3; I.push(a, d, b, b, d, e); }
  for (const [z, r, s] of [[c.z0, r0, -1], [c.z1, r1, 1]]) {
    const ctr = P.length / 3;
    P.push(0, 0, z); N.push(0, 0, s);
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; P.push(Math.cos(a) * r, Math.sin(a) * r, z); N.push(0, 0, s); }
    for (let i = 0; i < n; i++) { if (s > 0) I.push(ctr, ctr + 1 + i, ctr + 2 + i); else I.push(ctr, ctr + 2 + i, ctr + 1 + i); }
  }
  return {P, N, I};
}
const shapeOf = key => (SPEC[key].seg ? cylinder(SPEC[key]) : box(SPEC[key]));

// ---------- centre the bounding box on the origin ----------
const geo = PARTS.map(([name, mat, key]) => ({name, mat, key, ...shapeOf(key)}));
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const g of geo) for (let i = 0; i < g.P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.P[i + k]); hi[k] = Math.max(hi[k], g.P[i + k]); }
const shift = [0, 1, 2].map(k => -(lo[k] + hi[k]) / 2);
for (const g of geo) for (let i = 0; i < g.P.length; i += 3) for (let k = 0; k < 3; k++) g.P[i + k] = r5(g.P[i + k] + shift[k]);
const markers = Object.fromEntries(Object.entries(SPEC.markers).map(([k, v]) => [k, v.map((x, i) => r5(x + shift[i]))]));
const dims = [0, 1, 2].map(k => r5(hi[k] - lo[k]));
const bounds = {min: dims.map(d => r5(-d / 2)), max: dims.map(d => r5(d / 2))};
if (Math.abs(dims[2] - SPEC.length) > 1e-4) fail(`length ${dims[2]} != ${SPEC.length}`);

// ---------- the document ----------
const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene('weapon-putter');
doc.getRoot().setDefaultScene(scene);
const mats = Object.fromEntries(Object.entries(MATS).map(([k, m]) => [k, doc.createMaterial(`putter-${k}`).setBaseColorFactor(m.color).setMetallicFactor(m.metal).setRoughnessFactor(m.rough)]));
const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
let tris = 0, verts = 0;
for (const g of geo) {
  const prim = doc.createPrimitive().setMaterial(mats[g.mat]).setAttribute('POSITION', acc('VEC3', Float32Array.from(g.P))).setAttribute('NORMAL', acc('VEC3', Float32Array.from(g.N)))
    .setIndices(acc('SCALAR', Uint16Array.from(g.I)));
  scene.addChild(doc.createNode(g.name).setMesh(doc.createMesh(g.name).addPrimitive(prim)));
  tris += g.I.length / 3; verts += g.P.length / 3;
}
for (const [name, p] of Object.entries(markers)) scene.addChild(doc.createNode(name).setTranslation(p));
doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
const io = new NodeIO();
const glb = Buffer.from(await io.writeBinary(doc));

// ---------- verify the written bytes ----------
const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
if (chk.listMaterials().length !== Object.keys(MATS).length || chk.listTextures().length) fail('expected four plain materials and no textures');
for (const name of Object.keys(markers)) if (!chk.listNodes().some(n => n.getName() === name && !n.getMesh())) fail(`marker node ${name} missing`);
console.log(`putter: ${PARTS.length} parts, ${tris} tris / ${verts} verts, dims ${dims.join(' x ')} m, ${glb.length} B; markers ${Object.entries(markers).map(([k, v]) => `${k} ${v.join(',')}`).join(' | ')}`);

// ---------- public provenance ----------
const url = 'assets/models/weapon-putter.glb', provRel = 'assets/derivatives/weapon-putter.json';
const prov = {
  schema: 'terminal-state-derivative-v1', id: 'weapon-putter', itemId: 'putter', name: 'Putter', kind: 'melee',
  role: 'held / pickup / icon model of the mini-golf Putter (a light melee club placed on the Skyways mini-golf course\'s front desk; never loot, a find or market stock)',
  task: TASK,
  origin: 'hand-built from code primitives by this script (capped cylinders and boxes from the dimensions in its SPEC); no generation service, image, scan, texture or third-party asset was used',
  source: {kind: 'this script is the master: deterministic output (node ' + SELF + ' --check verifies the written bytes)', spec: SPEC},
  materials: Object.fromEntries(Object.entries(MATS).map(([k, m]) => [k, {baseColorFactor: m.color, metallic: m.metal, roughness: m.rough}])),
  output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: tris, vertices: verts, dims, bounds,
    nodes: {parts: PARTS.map(p => p[0]), markers: Object.keys(markers)}, markers},
  texturePolicy: 'no texture maps: plain PBR material factors only',
  convention: 'metres at real size, +Y up, the head toward -Z, the striking face looking along +X, the toe toward -Y; bounding box centred on the origin; empty marker nodes Grip / Tip',
  licence: 'authored for this project (assets/CREDITS.md: simple pickup / trim geometry authored for this project)',
  rebuild: `node ${SELF}`,
};
const provBytes = Buffer.from(JSON.stringify(prov, null, 1) + '\n');

// ---------- registry ----------
const vec = v => `[${v.map(x => String(r5(x))).join(', ')}]`;
const registry = `// GENERATED by ${SELF} (task ${TASK}) — do not edit.
// The mini-golf Putter: HAND-BUILT from code primitives (grip, ferrule, shaft, hosel, blade head with a face insert and a sight line; plain
// PBR materials, no texture maps, no generation). Provenance in assets/derivatives/weapon-putter.json. The held-weapon convention (metres,
// +Y up, the head toward -Z, the striking face along +X, the toe toward -Y, bounding box centred on the origin; the same empty marker nodes
// exist in the GLB): Grip = the upper hand on the grip, Tip = the centre of the striking face.
// A lazily delivered weapon model (weapons/lazyWeaponModels.ts); NOT a weapon-variety identity (weapons/varietyIds.ts) and never a find.
export const PUTTER_MODEL = {
  itemId: 'putter', kind: 'melee', url: '${url}', length: ${dims[2]},
  bounds: {min: ${vec(bounds.min)}, max: ${vec(bounds.max)}}, tris: ${tris},
  markers: {${Object.entries(markers).map(([k, v]) => `${k}: ${vec(v)}`).join(', ')}},
  parts: [],
} as const;
`;

const written = new Map([[url, glb], [provRel, provBytes]]);
if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, b] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), b);
  fs.writeFileSync(path.join(DRY, path.basename(REG)), registry);
  console.log(`dry run: written to ${DRY}`);
  process.exit(0);
}
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const entries = [...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}));
if (CHECK) {
  const bad = [];
  for (const [rel, b] of written) { const f = path.join(PUB, rel); if (!fs.existsSync(f) || !fs.readFileSync(f).equals(b)) bad.push(rel); }
  if (!fs.existsSync(REG) || fs.readFileSync(REG, 'utf8') !== registry) bad.push(path.relative(root, REG));
  for (const e of entries) { const a = allow.files.find(f => f.path === e.path); if (!a || a.bytes !== e.bytes || a.sha256 !== e.sha256) bad.push(`public-inputs.json ${e.path}`); }
  if (bad.length) fail(`--check: differs: ${bad.join(', ')}`);
  console.log('--check: every written file matches');
  process.exit(0);
}
const othersBefore = JSON.stringify(allow.files.filter(f => !written.has(f.path)));
fs.mkdirSync(path.join(PUB, 'assets/models'), {recursive: true});
for (const [rel, b] of written) fs.writeFileSync(path.join(PUB, rel), b);
fs.writeFileSync(REG, registry);
allow.files = [...allow.files.filter(f => !written.has(f.path)), ...entries].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !written.has(f.path))) !== othersBefore) fail('another allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json (its own two entries)`);
