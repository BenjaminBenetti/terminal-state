// Task track1-siren-blightbelly-20261031 (lane RIGS): PROJECT-OWNED stand-in fixtures for validating the appearance-locked rig
// path without the user's Siren art (never shipped as the Siren):
//  - writeStandinHumanoid: a procedural T-pose humanoid (closed tube / ellipsoid shells, UVs, normals, a PNG base colour),
//    authored in a Meshy-like normalised native frame (height 0.95, centred) so the placement scale / translation is exercised;
//  - writeStandinGarment: a procedural slip-like tube (open top / hem, UVs, JPEG base colour + PNG metallic-roughness) sized from
//    a placed body's torso sections (game frame == garment native frame, so the fit starts at s = 1, t = 0).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {Document} from '@gltf-transform/core';
import {io} from './native-glb.mjs';
import {computeNormals} from '../../zombie/lib/mesh.mjs';

const TAU = Math.PI * 2;

/** Tube along a path; cross-section ellipse (a along U, b along V) per ring; optional end caps. */
function tube(out, rings0, {segs = 20, caps = true, u0 = 0, u1 = 1, step = 0.02} = {}) {
  // subdivide so consecutive rings are <= `step` apart (dense, evenly sampled cross-sections)
  const rings = [rings0[0]];
  for (let k = 1; k < rings0.length; k++) {
    const a = rings0[k - 1], b = rings0[k], d = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]), n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) { const t = i / n; rings.push({c: a.c.map((v, q) => v + (b.c[q] - v) * t), U: b.U, V: b.V, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t}); }
  }
  const base = out.pos.length / 3;
  rings.forEach((r, k) => {
    for (let s = 0; s <= segs; s++) {
      const th = TAU * s / segs, c = Math.cos(th), sn = Math.sin(th);
      out.pos.push(r.c[0] + r.U[0] * r.a * c + r.V[0] * r.b * sn, r.c[1] + r.U[1] * r.a * c + r.V[1] * r.b * sn, r.c[2] + r.U[2] * r.a * c + r.V[2] * r.b * sn);
      out.uv.push(u0 + (u1 - u0) * s / segs, k / (rings.length - 1));
    }
  });
  const W = segs + 1;
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < segs; s++) {
    const a = base + k * W + s, b = a + 1, c = a + W, d = c + 1;
    out.idx.push(a, c, b, b, c, d);
  }
  if (caps) for (const [k, flip] of [[0, true], [rings.length - 1, false]]) {
    const ci = out.pos.length / 3; out.pos.push(...rings[k].c); out.uv.push((u0 + u1) / 2, k ? 1 : 0);
    for (let s = 0; s < segs; s++) { const a = base + k * W + s, b = a + 1; if (flip) out.idx.push(ci, b, a); else out.idx.push(ci, a, b); }
  }
}
const ringsY = (list, U = [1, 0, 0], V = [0, 0, 1]) => list.map(([x, y, z, a, b]) => ({c: [x, y, z], U, V, a, b}));
const ringsX = list => list.map(([x, y, z, a, b]) => ({c: [x, y, z], U: [0, 1, 0], V: [0, 0, 1], a, b}));

async function pngTexture(w, h, fn, format = 'png') {
  const d = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x / w, y / h), (y * w + x) * 3);
  const img = sharp(d, {raw: {width: w, height: h, channels: 3}});
  return format === 'jpeg' ? img.jpeg({quality: 88}).toBuffer() : img.png().toBuffer();
}

async function writeMesh(file, {pos, uv, idx, nrm}, textures, materialProps = {}) {
  const doc = new Document(), buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(idx)).setBuffer(buf));
  const mat = doc.createMaterial().setDoubleSided(true).setMetallicFactor(materialProps.metallic ?? 0).setRoughnessFactor(1);
  if (textures.base) mat.setBaseColorTexture(doc.createTexture().setImage(textures.base.bytes).setMimeType(textures.base.mime));
  if (textures.mr) mat.setMetallicRoughnessTexture(doc.createTexture().setImage(textures.mr.bytes).setMimeType(textures.mr.mime));
  prim.setMaterial(mat);
  doc.createScene().addChild(doc.createNode('geometry_0').setMesh(doc.createMesh('geometry_0').addPrimitive(prim)));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  await io().write(file, doc);
  return file;
}

/** Procedural T-pose humanoid (1.70 m authored, written at Meshy-like normalised scale 0.95 / 1.70, centred on y = 0). */
export async function writeStandinHumanoid(file) {
  const m = {pos: [], uv: [], idx: []};
  for (const sg of [1, -1]) {
    // leg (ankle -> hip) and foot
    tube(m, ringsY([[sg * 0.11, 0.03, 0, 0.045, 0.05], [sg * 0.11, 0.08, -0.01, 0.040, 0.042], [sg * 0.11, 0.20, -0.01, 0.048, 0.050], [sg * 0.108, 0.45, -0.01, 0.055, 0.058], [sg * 0.104, 0.65, -0.01, 0.065, 0.068], [sg * 0.10, 0.84, -0.01, 0.075, 0.078]]), {segs: 18});
    tube(m, [{c: [sg * 0.11, 0.03, -0.07], U: [1, 0, 0], V: [0, 1, 0], a: 0.04, b: 0.028}, {c: [sg * 0.11, 0.03, 0.04], U: [1, 0, 0], V: [0, 1, 0], a: 0.045, b: 0.03}, {c: [sg * 0.11, 0.025, 0.13], U: [1, 0, 0], V: [0, 1, 0], a: 0.04, b: 0.02}], {segs: 14});
    // arm (shoulder -> wrist -> flat hand), horizontal T-pose
    tube(m, ringsX([[sg * 0.08, 1.36, -0.03, 0.05, 0.05], [sg * 0.16, 1.36, -0.03, 0.045, 0.045], [sg * 0.34, 1.355, -0.025, 0.04, 0.04], [sg * 0.45, 1.355, -0.02, 0.034, 0.034], [sg * 0.55, 1.355, -0.015, 0.022, 0.028],
      [sg * 0.60, 1.355, -0.01, 0.02, 0.05], [sg * 0.68, 1.35, -0.005, 0.016, 0.045], [sg * 0.73, 1.345, 0, 0.008, 0.02]]), {segs: 16});
  }
  // torso (crotch -> shoulders), neck, head
  tube(m, ringsY([[0, 0.76, -0.01, 0.15, 0.10], [0, 0.85, -0.01, 0.16, 0.105], [0, 1.05, 0.0, 0.12, 0.085], [0, 1.22, 0.0, 0.15, 0.11], [0, 1.33, -0.01, 0.16, 0.09], [0, 1.40, -0.015, 0.13, 0.07], [0, 1.42, -0.015, 0.06, 0.05]]), {segs: 28});
  tube(m, ringsY([[0, 1.38, -0.02, 0.05, 0.05], [0, 1.53, -0.02, 0.047, 0.05]]), {segs: 16});
  const head = []; for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + Math.PI * k / 12; head.push([0, 1.60 + 0.10 * Math.sin(a), 0.0, Math.max(0.004, 0.085 * Math.cos(a)), Math.max(0.004, 0.10 * Math.cos(a))]); }
  tube(m, ringsY(head), {segs: 20});
  const k = 0.95 / 1.70;
  const pos = m.pos.map((v, i) => i % 3 === 1 ? v * k - 0.475 : v * k);
  const nrm = computeNormals(Float32Array.from(pos), Uint32Array.from(m.idx));
  const base = await pngTexture(64, 64, (u, v) => [150 + 80 * u | 0, 120 + 100 * v | 0, ((u * 8 | 0) + (v * 8 | 0)) % 2 ? 210 : 90]);
  return writeMesh(file, {pos, uv: m.uv, idx: m.idx, nrm}, {base: {bytes: base, mime: 'image/png'}});
}

/**
 * Procedural garment around a placed body (game-space positions): per ring the torso half-extents of the body (|x| < shoulder) x 1.45 (ellipse around the box)
 * + 1 cm, flaring below the hips. Written in the game frame (fit init s = 1, t = 0).
 */
export async function writeStandinGarment(file, bodyPos, {top = 1.30, bottom = 0.42, shoulderX = 0.17} = {}) {
  const rows = 28, rings = [];
  for (let r = 0; r <= rows; r++) {
    const y = top - (top - bottom) * r / rows;
    let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
    for (let i = 0; i < bodyPos.length; i += 3) {
      if (Math.abs(bodyPos[i + 1] - y) > 0.015 || Math.abs(bodyPos[i]) > shoulderX) continue;
      x0 = Math.min(x0, bodyPos[i]); x1 = Math.max(x1, bodyPos[i]); z0 = Math.min(z0, bodyPos[i + 2]); z1 = Math.max(z1, bodyPos[i + 2]);
    }
    const flare = Math.max(0, 0.80 - y) * 0.35;
    rings.push({c: [(x0 + x1) / 2, y, (z0 + z1) / 2], U: [1, 0, 0], V: [0, 0, 1], a: (x1 - x0) / 2 * 1.45 + 0.01 + flare, b: (z1 - z0) / 2 * 1.45 + 0.01 + flare});
  }
  const m = {pos: [], uv: [], idx: []};
  tube(m, rings, {segs: 40, caps: false});
  const nrm = computeNormals(Float32Array.from(m.pos), Uint32Array.from(m.idx));
  const base = await pngTexture(128, 128, (u, v) => { const lace = (Math.sin(u * 60) * Math.sin(v * 60) > 0.2) ? 235 : 170; return [lace, lace, lace + 10 > 255 ? 255 : lace + 10]; }, 'jpeg');
  const mr = await pngTexture(32, 32, () => [255, 200, 30]);
  return writeMesh(file, {pos: m.pos, uv: m.uv, idx: m.idx, nrm}, {base: {bytes: base, mime: 'image/jpeg'}, mr: {bytes: mr, mime: 'image/png'}}, {metallic: 1});
}
