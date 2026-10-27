#!/usr/bin/env node
// Iteration04 Lane E QA without a browser: CPU renders + alignment metrics for the see-through rifle optic.
// - World backdrop: a CPU-rendered tiled corridor (the game's own wall/platform/ceiling textures) with the rigged
//   zombie (bind pose) at ~9 m, from the player's eye at the hip FOV (75) or the rifle ADS FOV (52).
// - Viewmodel: rifle.glb (before) / rifle-optic.glb (after) posed exactly like game/src/weapons/viewmodel.ts at rest
//   (numbers parsed from weapons.ts/optic.ts), drawn over the backdrop with a 54° camera after a depth clear:
//   depth-only lens mask -> opaque gun -> transparent front glass -> rear lens (JS port of the optic.ts shader).
// - HUD crosshair drawn as game/src/styles.css does (hip: ticks+dot; legacy ADS: dimmed ticks+dot; optic ADS: hidden).
// Shading is a Lambert/hemisphere approximation of three.js PBR, labelled as such. Writes qa-artifacts/iter04-optic/.
// Usage: node tools/asset-pipeline/props/qa-rifle-optic-iteration04.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import sharp from 'sharp';
import {Raster, loadGlb, sample} from './rifle-optic-raster.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTDIR = path.join(REPO, 'qa-artifacts/iter04-optic');
fs.mkdirSync(OUTDIR, {recursive: true});
const W = 1280, H = 720, SS = 2, WS = W * SS, HS = H * SS;
const EYE_Y = 1.62;

// ------------------------------------------------------------------ numbers from the game source (no drift)
const weaponsTs = fs.readFileSync(path.join(REPO, 'game/src/weapons/weapons.ts'), 'utf8');
const opticTs = fs.readFileSync(path.join(REPO, 'game/src/weapons/optic.ts'), 'utf8');
const vmTs = fs.readFileSync(path.join(REPO, 'game/src/weapons/viewmodel.ts'), 'utf8');
const rifleView = weaponsTs.match(/rifle: \{[\s\S]*?view: \{model: 'rifle', hip: \[([^\]]+)\], aim: \[([^\]]+)\], hipYaw: ([-\d.]+), hipPitch: ([-\d.]+), hipRoll: ([-\d.]+), length: [\d.]+, optic: \{eyeRelief: ([\d.]+)\}\}/);
if (!rifleView) throw new Error('could not parse the rifle view from weapons.ts');
const num = s => s.split(',').map(Number);
const DEF = {hip: num(rifleView[1]), aim: num(rifleView[2]), hipYaw: +rifleView[3], hipPitch: +rifleView[4], hipRoll: +rifleView[5], eyeRelief: +rifleView[6]};
const lookNum = k => { const m = opticTs.match(new RegExp(`\\b${k}: ([-\\d.]+)`)); if (!m) throw new Error(k); return +m[1]; };
const LOOK = Object.fromEntries(['dotRadius', 'glowRadius', 'thinHalf', 'thickHalf', 'gap', 'post', 'eyeBoxInner', 'eyeBoxOuter', 'maskOffset'].map(k => [k, lookNum(k)]));
LOOK.dotColor = opticTs.match(/dotColor: \[([^\]]+)\]/)[1].split(',').map(Number);
const KICK = {pos: +opticTs.match(/OPTIC_ADS_KICK = \{pos: ([\d.]+)/)[1], rot: +opticTs.match(/OPTIC_ADS_KICK = \{pos: [\d.]+, rot: ([\d.]+)/)[1]};
const VM_FOV = +vmTs.match(/new THREE\.PerspectiveCamera\((\d+), 1, ([\d.]+), (\d+)\)/)[1];
const VM_NEAR = +vmTs.match(/new THREE\.PerspectiveCamera\((\d+), 1, ([\d.]+), (\d+)\)/)[2];
const AIM_FOV = +weaponsTs.match(/aimFov: (\d+), moveMult: 0.95/)[1];
const HIP_FOV = 75; // Game.settings.fov default
const HIP_SPREAD = 0.028; // rifle spreadHip (crosshair gap at rest)
const AIM_SPREAD = 0.004;

// ------------------------------------------------------------------ helpers
const srgbToLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const linToSrgb = c => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
async function texFile(f) { const {data, info} = await sharp(path.join(REPO, 'game/public/assets/textures', f)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; }

// ------------------------------------------------------------------ world backdrop (CPU)
const wallTex = await texFile('wall-working-face-color.jpg'), floorTex = await texFile('platform-working-face-color.jpg'), ceilTex = await texFile('ceiling-working-face-color.jpg');
const zombie = await loadGlb(path.join(REPO, 'game/public/assets/models/zombie-rigged.glb'));
const LIGHTS = []; for (let z = -2; z > -40; z -= 6) LIGHTS.push([0, 3.0, z]);
function worldLight(p, n) {
  let l = 0.16;
  for (const L of LIGHTS) { const d = [L[0] - p[0], L[1] - p[1], L[2] - p[2]], dd = Math.hypot(...d); l += 2.4 * Math.max(0, dot(n, d) / dd) / (1 + dd * dd * 0.28); }
  return l;
}
function renderWorld(fovY) {
  const r = new Raster(WS, HS, [0, 0, 0]);
  r.setCamera({kind: 'persp', fovY, near: 0.05});
  const X0 = -2.4, X1 = 2.4, Y1 = 3.2, Z0 = -40, Z1 = 3, STEP = 1.5;
  const quads = []; // [corner, edgeU, edgeV, normal, kind]
  for (let z = Z1; z > Z0; z -= STEP) {
    for (let x = X0; x < X1; x += STEP) { quads.push([[x, 0, z], [Math.min(STEP, X1 - x), 0, 0], [0, 0, -STEP], [0, 1, 0], 'floor']); quads.push([[x, Y1, z - STEP], [Math.min(STEP, X1 - x), 0, 0], [0, 0, STEP], [0, -1, 0], 'ceil']); }
    for (let y = 0; y < Y1; y += STEP) { const h = Math.min(STEP, Y1 - y); quads.push([[X0, y, z], [0, 0, -STEP], [0, h, 0], [1, 0, 0], 'wall']); quads.push([[X1, y, z - STEP], [0, 0, STEP], [0, h, 0], [-1, 0, 0], 'wall']); }
  }
  for (let x = X0; x < X1; x += STEP) for (let y = 0; y < Y1; y += STEP) quads.push([[x, y, Z0], [Math.min(STEP, X1 - x), 0, 0], [0, Math.min(STEP, Y1 - y), 0], [0, 0, 1], 'wall']);
  for (const [c, u, v, n, kind] of quads) {
    const P = [c, [c[0] + u[0], c[1] + u[1], c[2] + u[2]], [c[0] + u[0] + v[0], c[1] + u[1] + v[1], c[2] + u[2] + v[2]], [c[0] + v[0], c[1] + v[1], c[2] + v[2]]];
    const V = new Float32Array(P.flatMap(p => [p[0], p[1] - EYE_Y, p[2]])), Wp = new Float32Array(P.flat());
    r.draw(V, [0, 1, 2, 0, 2, 3], {w: {data: Wp, size: 3}}, f => {
      const p = f.attrs.w; let col;
      if (kind === 'floor') col = sample(floorTex, p[0] / 2.4, p[2] / 2.28);
      else if (kind === 'ceil') col = sample(ceilTex, p[0] / 3.6, p[2] / 1.15);
      else { const s = n[0] !== 0 ? p[2] : p[0]; let y = p[1]; if (y >= 1.8) y = 1.4988 + ((y - 1.4988) % 0.2989); col = sample(wallTex, s / 3.6, 1 - y / 1.8); }
      const lit = worldLight(p, n), dist = Math.hypot(p[0], p[1] - EYE_Y, p[2]), fog = Math.exp(-dist * 0.03);
      return col.map(ch => linToSrgb(Math.min(1, srgbToLin(ch) * lit * fog) / (1 + 0.15 * srgbToLin(ch) * lit)) ).concat(1);
    }, {cull: 'none'});
  }
  // zombie (bind pose, facing the player) at ~9 m, slightly right of centre
  const ZP = [0.12, 0, -9.0];
  for (const m of zombie) {
    const V = new Float32Array(m.P.length), Wp = new Float32Array(m.P.length);
    for (let i = 0; i < m.P.length; i += 3) { const x = m.P[i] + ZP[0], y = m.P[i + 1] + ZP[1], z = m.P[i + 2] + ZP[2]; Wp[i] = x; Wp[i + 1] = y; Wp[i + 2] = z; V[i] = x; V[i + 1] = y - EYE_Y; V[i + 2] = z; }
    r.draw(V, m.I, {uv: {data: m.UV, size: 2}, w: {data: Wp, size: 3}}, f => {
      const col = sample(m.tex, f.attrs.uv[0], f.attrs.uv[1]), n = f.n.slice(), nn = f.front ? n : n.map(x => -x);
      const lit = 0.25 + worldLight(f.attrs.w, nn) * 0.9;
      return col.map(ch => linToSrgb(Math.min(1, srgbToLin(ch) * lit))).concat(1);
    }, {cull: 'none'});
  }
  return r;
}

// ------------------------------------------------------------------ viewmodel
const oldRifle = await loadGlb(path.join(REPO, 'game/public/assets/models/rifle.glb'));
const newRifle = await loadGlb(path.join(REPO, 'game/public/assets/models/rifle-optic.glb'));
const anchors = async file => { const {NodeIO} = await import('@gltf-transform/core'); const d = await new NodeIO().read(file); const o = {}; for (const n of d.getRoot().listNodes()) o[n.getName()] = n.getWorldTranslation(); return o; };
const A = await anchors(path.join(REPO, 'game/public/assets/models/rifle-optic.glb'));
const LENS_R = newRifle.find(m => m.node === 'OpticGlassRear').P.reduce((mx, v, i, P) => i % 3 === 0 ? Math.max(mx, Math.hypot(P[i] - A.OpticRear[0], P[i + 1] - A.OpticRear[1])) : mx, 0);
const gp = new THREE.Vector3(...A.Grip), opticPoint = new THREE.Vector3(...A.OpticRear).sub(gp);
const opticAim = new THREE.Vector3(0, 0, -DEF.eyeRelief).sub(opticPoint);

/** Viewmodel.update at rest (no bob/sway/crouch/equip), optionally with a recoil kick value. */
function pose({optic, aimK, kick = 0}) {
  const hip = new THREE.Vector3(...DEF.hip), aim = optic ? opticAim.clone() : new THREE.Vector3(...DEF.aim), hipK = 1 - aimK, optK = optic ? aimK : 0;
  const pos = new THREE.Vector3().lerpVectors(hip, aim, aimK);
  pos.z += kick * (1 - optK * KICK.pos);
  const rot = new THREE.Euler(kick * 3.2 * (1 - optK * KICK.rot) + hipK * DEF.hipPitch, hipK * DEF.hipYaw, hipK * DEF.hipRoll);
  const q = new THREE.Quaternion().setFromEuler(rot);
  if (optic && optK > 0) pos.addScaledVector(opticPoint.clone().applyQuaternion(q).sub(opticPoint), -optK);
  return {pos, q};
}
function opticState({pos, q}, aimK) { // RifleOptic.update port
  const eye = pos.clone().negate().applyQuaternion(q.clone().invert()).sub(opticPoint);
  const lat = 1 - smoothstep(LOOK.eyeBoxInner, LOOK.eyeBoxOuter, Math.hypot(eye.x, eye.y));
  const dist = smoothstep(0.012, 0.035, eye.z) * (1 - smoothstep(DEF.eyeRelief * 2.2, DEF.eyeRelief * 3.5, eye.z));
  const k = Math.max(0, Math.min(1, aimK));
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).lerp(new THREE.Vector3(0, 0, -1), k).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).lerp(new THREE.Vector3(1, 0, 0), k);
  right.addScaledVector(dir, -right.dot(dir)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return {eye, clarity: lat * dist, dir: dir.toArray(), right: right.toArray(), up: up.toArray()};
}
const LIGHT = 0.5;
const HEMI = {sky: [0xf2, 0xe6, 0xcc].map(c => srgbToLin(c)), ground: [0x2a, 0x26, 0x22].map(c => srgbToLin(c)), i: 0.55 + 1.5 * LIGHT};
const KEYL = {dir: new THREE.Vector3(-1, 2, 1).normalize().toArray(), i: 0.4 + 1.2 * LIGHT};
function gunShade(tex, colorFactor) {
  return f => {
    const n = f.attrs.n ? f.attrs.n : f.n, l = Math.hypot(...n) || 1, nn = [n[0] / l, n[1] / l, n[2] / l];
    const h = 0.5 + 0.5 * nn[1], amb = HEMI.sky.map((s, k) => (s * h + HEMI.ground[k] * (1 - h)) * HEMI.i * 0.42);
    const diff = Math.max(0, dot(nn, KEYL.dir)) * KEYL.i * 0.55;
    const base = tex ? sample(tex, f.attrs.uv[0], f.attrs.uv[1]).map(srgbToLin) : colorFactor.slice(0, 3);
    return base.map((b, k) => linToSrgb(Math.min(1, b * (amb[k] + diff) * 1.6))).concat(1);
  };
}
function lensShader(st, aaRad) {
  const U = st, L = LOOK, dotLin = L.dotColor;
  return f => {
    const [x, y, z] = f.pos, len = Math.hypot(x, y, z), v = [x / len, y / len, z / len];
    const c = Math.max(dot(v, U.dir), 1e-3), t = [dot(v, U.right) / c, dot(v, U.up) / c];
    const aa = aaRad, lens = [f.attrs.uv[0] * 2 - 1, f.attrs.uv[1] * 2 - 1], lr = Math.hypot(...lens), clear = U.clarity;
    const band = (d, hw) => 1 - smoothstep(hw - aa, hw + aa, d);
    let acc = [0, 0, 0, 0];
    const over = (col, a) => { acc = [col[0] * a + acc[0] * (1 - a), col[1] * a + acc[1] * (1 - a), col[2] * a + acc[2] * (1 - a), a + acc[3] * (1 - a)]; };
    over([0.012, 0.016, 0.02], 0.92 + (0.07 - 0.92) * clear);
    over([0, 0, 0], smoothstep(0.55 + (0.8 - 0.55) * clear, 1, lr) * 0.9);
    const s = lens[0] * 0.6 + lens[1] * 0.8 - 0.35;
    over([0.55, 0.62, 0.7].map(q => q * (0.4 + LIGHT)), Math.exp(-s * s * 10.24) * (0.22 + (0.035 - 0.22) * clear));
    const ax = Math.abs(t[0]), ay = Math.abs(t[1]);
    const ink = Math.max(Math.max(band(ay, L.thinHalf) * smoothstep(L.gap - aa, L.gap + aa, ax), band(ax, L.thinHalf) * smoothstep(L.gap - aa, L.gap + aa, ay)),
      Math.max(band(ay, L.thickHalf) * smoothstep(L.post - aa, L.post + aa, ax), band(ax, L.thickHalf) * smoothstep(L.post - aa, L.post + aa, -t[1])));
    over([0.01, 0.01, 0.01], ink * 0.85 * clear);
    const r = Math.hypot(...t), lit = Math.max(band(r, L.dotRadius), Math.exp(-r * r / (2 * L.glowRadius * L.glowRadius)) * 0.45) * clear;
    over(dotLin, lit);
    const a = acc[3];
    return [linToSrgb(acc[0] / Math.max(a, 1e-4)), linToSrgb(acc[1] / Math.max(a, 1e-4)), linToSrgb(acc[2] / Math.max(a, 1e-4)), a];
  };
}
function drawGun(r, meshes, {pos, q}, {optic, aimK}) {
  r.setCamera({kind: 'persp', fovY: VM_FOV, near: VM_NEAR});
  r.depth.fill(Infinity); // renderer.clearDepth() between the world and viewmodel passes
  const M = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-gp.x, -gp.y, -gp.z));
  const e = M.elements, rotOnly = new THREE.Matrix3().setFromMatrix4(M).elements;
  const xf = P => { const o = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; o[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; o[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; o[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; } return o; };
  const xn = Nn => { const o = new Float32Array(Nn.length); for (let i = 0; i < Nn.length; i += 3) { const x = Nn[i], y = Nn[i + 1], z = Nn[i + 2]; o[i] = rotOnly[0] * x + rotOnly[3] * y + rotOnly[6] * z; o[i + 1] = rotOnly[1] * x + rotOnly[4] * y + rotOnly[7] * z; o[i + 2] = rotOnly[2] * x + rotOnly[5] * y + rotOnly[8] * z; } return o; };
  const glassRear = meshes.find(m => m.node === 'OpticGlassRear');
  let st = null;
  if (optic && glassRear) { // 1. depth-only lens mask, maskOffset behind the glass
    const Pm = glassRear.P.slice(); for (let i = 2; i < Pm.length; i += 3) Pm[i] -= LOOK.maskOffset;
    r.draw(xf(Pm), glassRear.I, null, () => [0, 0, 0, 1], {colorWrite: false});
    st = opticState({pos, q}, aimK);
  }
  for (const m of meshes) { // 2. opaque
    if (m.material.alphaMode === 'BLEND') continue;
    r.draw(xf(m.P), m.I, {uv: {data: m.UV, size: 2}, n: {data: xn(m.N), size: 3}}, gunShade(m.tex, m.material.baseColorFactor));
  }
  for (const m of meshes) { // 3. transparent: front glass (standard), rear glass (lens shader in the viewmodel)
    if (m.material.alphaMode !== 'BLEND') continue;
    const opts = {depthWrite: false};
    if (m.node === 'OpticGlassRear' && optic) r.draw(xf(m.P), m.I, {uv: {data: m.UV, size: 2}}, lensShader(st, 0.75 * 2 * Math.tan(VM_FOV * Math.PI / 360) / HS), opts);
    else { const cf = m.material.baseColorFactor; r.draw(xf(m.P), m.I, {uv: {data: m.UV, size: 2}}, () => [...cf.slice(0, 3).map(linToSrgb), cf[3]], opts); }
  }
  return st;
}
// normals for loadGlb meshes (not loaded by the shared helper)
async function withNormals(file, meshes) {
  const {NodeIO} = await import('@gltf-transform/core'); const d = await new NodeIO().read(file); let k = 0;
  for (const node of d.getRoot().listNodes()) { const mesh = node.getMesh(); if (!mesh) continue; for (const p of mesh.listPrimitives()) meshes[k++].N = p.getAttribute('NORMAL').getArray(); }
}
await withNormals(path.join(REPO, 'game/public/assets/models/rifle.glb'), oldRifle);
await withNormals(path.join(REPO, 'game/public/assets/models/rifle-optic.glb'), newRifle);

function crosshairSvg(mode, fovY) { // styles.css #crosshair at 1x pixels (rendered before the 2x downsample -> scaled)
  if (mode === 'hidden') return '';
  const spread = mode === 'hip' ? HIP_SPREAD : AIM_SPREAD;
  const gap = Math.max(3, Math.min(60, Math.round(Math.tan(spread) / Math.tan(fovY * Math.PI / 360) * (H / 2)))) * SS, cx = WS / 2, cy = HS / 2, L = 8 * SS, T = 2 * SS;
  const op = mode === 'aim' ? 0.25 : 1, fill = `rgba(236,228,207,${0.85 * op})" stroke="rgba(0,0,0,${0.5 * op})" stroke-width="${SS}`;
  return `<rect x="${cx - T / 2}" y="${cy - gap - L}" width="${T}" height="${L}" fill="${fill}"/><rect x="${cx - T / 2}" y="${cy + gap}" width="${T}" height="${L}" fill="${fill}"/>` +
    `<rect x="${cx - gap - L}" y="${cy - T / 2}" width="${L}" height="${T}" fill="${fill}"/><rect x="${cx + gap}" y="${cy - T / 2}" width="${L}" height="${T}" fill="${fill}"/>` +
    `<rect x="${cx - T / 2}" y="${cy - T / 2}" width="${T}" height="${T}" fill="#ece4cf"/>`;
}
async function frame(file, {model, optic, aimK, kick = 0, fovY, cross, label}) {
  const r = renderWorld(fovY);
  const p = pose({optic, aimK, kick});
  const st = drawGun(r, model, p, {optic, aimK});
  const svg = `<svg width="${WS}" height="${HS}">${crosshairSvg(cross, fovY)}<rect x="0" y="${HS - 60}" width="${WS}" height="60" fill="rgba(0,0,0,0.55)"/><text x="16" y="${HS - 20}" font-size="34" font-family="sans-serif" fill="#fff">${label}</text></svg>`;
  await r.save(path.join(OUTDIR, file), {downsample: 1, overlaySvg: svg});
  await sharp(path.join(OUTDIR, file)).resize(W, H, {kernel: 'lanczos3'}).toFile(path.join(OUTDIR, file + '.tmp.png'));
  fs.renameSync(path.join(OUTDIR, file + '.tmp.png'), path.join(OUTDIR, file));
  return {raster: r, state: st, pose: p};
}

// ------------------------------------------------------------------ line-of-sight through the optic (model space)
function rayTris(meshes, o, d, zMin, opaqueOnly) {
  let hits = [];
  for (const m of meshes) {
    if (opaqueOnly && m.material.alphaMode === 'BLEND') continue;
    for (let f = 0; f < m.I.length; f += 3) {
      const a = 3 * m.I[f], b = 3 * m.I[f + 1], c = 3 * m.I[f + 2];
      const e1 = [m.P[b] - m.P[a], m.P[b + 1] - m.P[a + 1], m.P[b + 2] - m.P[a + 2]], e2 = [m.P[c] - m.P[a], m.P[c + 1] - m.P[a + 1], m.P[c + 2] - m.P[a + 2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - m.P[a], o[1] - m.P[a + 1], o[2] - m.P[a + 2]], u = dot(tv, pv) / det; if (u < 0 || u > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = dot(d, qv) / det; if (v < 0 || u + v > 1) continue;
      const t = dot(e2, qv) / det; if (t <= 0) continue;
      const z = o[2] + d[2] * t; if (z < zMin) continue;
      hits.push({node: m.node, z: +z.toFixed(4)});
    }
  }
  return hits;
}
const eyeModel = [A.OpticRear[0], A.OpticRear[1], A.OpticRear[2] + DEF.eyeRelief];
const losGrid = [];
for (let iy = -3; iy <= 3; iy++) for (let ix = -3; ix <= 3; ix++) { const dx = ix * 0.005, dy = iy * 0.005; if (Math.hypot(dx, dy) <= 0.019) losGrid.push([dx, dy]); }
const los = {};
for (const [name, meshes] of [['rifle.glb', oldRifle], ['rifle-optic.glb', newRifle]]) {
  let blockedInOptic = 0, blockedBeyond = 0, glassHits = 0;
  for (const [dx, dy] of losGrid) {
    const o = [eyeModel[0] + dx, eyeModel[1] + dy, eyeModel[2]];
    const opaque = rayTris(meshes, o, [0, 0, -1], -0.47, true);
    const inOptic = opaque.filter(h => h.z >= A.OpticFront[2] - 0.015), beyond = opaque.filter(h => h.z < A.OpticFront[2] - 0.015);
    if (inOptic.length) blockedInOptic++; if (beyond.length) blockedBeyond++;
    glassHits += rayTris(meshes, o, [0, 0, -1], -0.47, false).length - opaque.length;
  }
  los[name] = {rays: losGrid.length, rayPattern: '5 mm grid within 19 mm of the optic axis, from the ADS eye along -Z (bore direction)', blockedByOpaqueInsideOptic: blockedInOptic, blockedBeyondOptic: blockedBeyond, glassSurfacesCrossed: glassHits};
}

// ------------------------------------------------------------------ renders
const metrics = {note: 'CPU approximation (Lambert/hemisphere shading, nearest texture sampling, 2x supersampling) - not a WebGL capture', sourceNumbers: {DEF, LOOK, KICK, VM_FOV, VM_NEAR, AIM_FOV, HIP_FOV}};
const hipOld = await frame('01a-hip-before-rifle.png', {model: oldRifle, optic: false, aimK: 0, fovY: HIP_FOV, cross: 'hip', label: 'BEFORE hip: rifle.glb (opaque AI optic) - CPU approx'});
const hipNew = await frame('01b-hip-after-rifle-optic.png', {model: newRifle, optic: true, aimK: 0, fovY: HIP_FOV, cross: 'hip', label: 'AFTER hip: rifle-optic.glb, same iteration-02 hip pose - CPU approx'});
const adsOld = await frame('02-ads-before.png', {model: oldRifle, optic: false, aimK: 1, fovY: AIM_FOV, cross: 'aim', label: 'BEFORE ADS: eye over the opaque optic, HUD crosshair (legacy aim)'});
const adsNew = await frame('03-ads-after.png', {model: newRifle, optic: true, aimK: 1, fovY: AIM_FOV, cross: 'hidden', label: 'AFTER ADS: world through the glass, collimated reticle, HUD crosshair hidden'});
const kickNew = await frame('05c-ads-after-recoil.png', {model: newRifle, optic: true, aimK: 1, kick: 0.042, fovY: AIM_FOV, cross: 'hidden', label: 'AFTER ADS at peak single-shot kick (0.042): lens stays on the eye, dot on the aim line'});
const tr = [];
for (const [k, file] of [[0.5, '05a-ads-raise-50.png'], [0.85, '05b-ads-raise-85.png']]) {
  const fov = HIP_FOV + (AIM_FOV - HIP_FOV) * k;
  tr.push(await frame(file, {model: newRifle, optic: true, aimK: k, fovY: fov, cross: k > 0.6 ? 'hidden' : 'aim', label: `AFTER raising to ADS, aimBlend ${k} (exit pupil opens as the eye reaches the axis)`}));
}
// reticle location in the ADS render (red pixels), lens radius analytic
function redCentroid(r) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) { const i = 3 * (y * r.W + x), R = r.color[i], G = r.color[i + 1], B = r.color[i + 2]; if (R > 170 && G < 110 && B < 100 && R - G > 110) { sx += x; sy += y; n++; } }
  return n ? {x: sx / n / SS, y: sy / n / SS, pixels: n} : null;
}
const pxPerRad720 = (H / 2) / Math.tan(VM_FOV * Math.PI / 360);
const reticle = redCentroid(adsNew.raster), reticleKick = redCentroid(kickNew.raster);
metrics.ads = {
  opticRearRelGrip: opticPoint.toArray().map(v => +v.toFixed(5)), adsPivot: opticAim.toArray().map(v => +v.toFixed(5)), legacyAimPivot: DEF.aim,
  eyeInOpticFrameAtRest: adsNew.state.eye.toArray().map(v => +v.toFixed(6)), clarityAtRest: +adsNew.state.clarity.toFixed(4), reticleDirAtRest: adsNew.state.dir.map(v => +v.toFixed(6)),
  reticleCentroidPx1280x720: reticle && {x: +reticle.x.toFixed(2), y: +reticle.y.toFixed(2), offsetFromCentre: [+(reticle.x - W / 2).toFixed(2), +(reticle.y - H / 2).toFixed(2)]},
  reticleCentroidAtKickPx: reticleKick && {x: +reticleKick.x.toFixed(2), y: +reticleKick.y.toFixed(2), clarity: +kickNew.state.clarity.toFixed(4), eyeInOpticFrame: kickNew.state.eye.toArray().map(v => +v.toFixed(5))},
  lensRadiusM: +LENS_R.toFixed(5), lensRadiusPx: {at720p: +(LENS_R / DEF.eyeRelief * pxPerRad720).toFixed(1), at1080p: +(LENS_R / DEF.eyeRelief * pxPerRad720 * 1.5).toFixed(1), fractionOfScreenHeight: +(2 * LENS_R / DEF.eyeRelief * pxPerRad720 / H).toFixed(3)},
  reticleDotDiameterPx: {at720p: +(2 * LOOK.dotRadius * pxPerRad720).toFixed(1), at1080p: +(2 * LOOK.dotRadius * pxPerRad720 * 1.5).toFixed(1)},
  hip: {clarity: +hipNew.state.clarity.toFixed(4), eyeInOpticFrame: hipNew.state.eye.toArray().map(v => +v.toFixed(4))},
  raise: tr.map((f, i) => ({aimBlend: [0.5, 0.85][i], clarity: +f.state.clarity.toFixed(4)})),
  hitscan: 'Game.fire() casts from the main camera position along camera forward (screen centre); at full ADS the reticle direction is camera -Z, i.e. the same line.',
};
metrics.lineOfSight = los;

// side-by-side sheets
async function sheet(files, out, cols) {
  const imgs = await Promise.all(files.map(f => sharp(path.join(OUTDIR, f)).resize(W / 2, H / 2).toBuffer()));
  const rows = Math.ceil(imgs.length / cols);
  await sharp({create: {width: cols * W / 2, height: rows * H / 2, channels: 3, background: '#000'}}).composite(imgs.map((b, i) => ({input: b, left: (i % cols) * W / 2, top: Math.floor(i / cols) * H / 2}))).png().toFile(path.join(OUTDIR, out));
}
await sheet(['01a-hip-before-rifle.png', '01b-hip-after-rifle-optic.png', '02-ads-before.png', '03-ads-after.png'], '00-summary-before-after.png', 2);
await sheet(['05a-ads-raise-50.png', '05b-ads-raise-85.png', '03-ads-after.png', '05c-ads-after-recoil.png'], '05-ads-raise-and-recoil.png', 2);
// centre zoom of the ADS view (3x) with a 1 px screen-centre marker outside the lens centre
{
  const crop = {left: W / 2 - 200, top: H / 2 - 120, width: 400, height: 240};
  const z = await sharp(path.join(OUTDIR, '03-ads-after.png')).extract(crop).resize(1200, 720, {kernel: 'nearest'}).toBuffer();
  const svg = `<svg width="1200" height="720"><line x1="600" y1="0" x2="600" y2="40" stroke="#0f0"/><line x1="600" y1="680" x2="600" y2="720" stroke="#0f0"/><line x1="0" y1="360" x2="40" y2="360" stroke="#0f0"/><line x1="1160" y1="360" x2="1200" y2="360" stroke="#0f0"/><text x="10" y="710" font-size="20" fill="#0f0" font-family="sans-serif">3x centre crop of 03-ads-after.png; green ticks = exact screen centre (hitscan line)</text></svg>`;
  await sharp(z).composite([{input: Buffer.from(svg)}]).png().toFile(path.join(OUTDIR, '04-ads-after-centre-3x.png'));
}

// ------------------------------------------------------------------ model views: rear (eye) view and axial cut-away, before/after
async function modelViews() {
  const S = 640, out = [];
  const checker = new Uint8Array(S * S * 3); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = ((x >> 4) + (y >> 4)) & 1 ? 200 : 120; checker.set([c, c + 10, c], 3 * (y * S + x)); }
  for (const [name, meshes, optic] of [['rifle.glb', oldRifle, false], ['rifle-optic.glb', newRifle, true]]) {
    // rear view along the axis (perspective from the ADS eye, 40° fov), checker backdrop = "world"
    const r = new Raster(S, S, {data: checker});
    r.setCamera({kind: 'persp', fovY: 40, near: 0.005});
    const V = m => { const o = new Float32Array(m.P.length); for (let i = 0; i < m.P.length; i += 3) { o[i] = m.P[i] - eyeModel[0]; o[i + 1] = m.P[i + 1] - eyeModel[1]; o[i + 2] = m.P[i + 2] - eyeModel[2]; } return o; };
    for (const m of meshes) if (m.material.alphaMode !== 'BLEND') r.draw(V(m), m.I, {uv: {data: m.UV, size: 2}, n: {data: m.N, size: 3}}, gunShade(m.tex, m.material.baseColorFactor));
    for (const m of meshes) if (m.material.alphaMode === 'BLEND') { const cf = m.material.baseColorFactor; r.draw(V(m), m.I, null, () => [...cf.slice(0, 3).map(linToSrgb), cf[3]], {depthWrite: false}); }
    const f1 = path.join(OUTDIR, `_mv-${name}-eye.png`);
    await r.save(f1, {overlaySvg: `<svg width="${S}" height="${S}"><text x="10" y="${S - 12}" font-size="15" fill="#ff0" font-family="sans-serif">${name}: raw geometry from the ADS eye (no lens shader/mask), checker = world</text></svg>`}); out.push(f1);
    // axial cut-away: the -X half of the scope (triangle centroid x <= axis), seen in perspective from the +X/rear/above
    const r2 = new Raster(S, S, [235, 235, 235]);
    r2.setCamera({kind: 'persp', fovY: 30, near: 0.01});
    const target = new THREE.Vector3(A.OpticRear[0], A.OpticRear[1], (A.OpticRear[2] + A.OpticFront[2]) / 2);
    const camM = new THREE.Matrix4().lookAt(target.clone().add(new THREE.Vector3(0.2, 0.09, 0.17)), target, new THREE.Vector3(0, 1, 0)).setPosition(target.clone().add(new THREE.Vector3(0.2, 0.09, 0.17)));
    const viewE = camM.clone().invert().elements;
    const toView = P => { const o = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; o[i] = viewE[0] * x + viewE[4] * y + viewE[8] * z + viewE[12]; o[i + 1] = viewE[1] * x + viewE[5] * y + viewE[9] * z + viewE[13]; o[i + 2] = viewE[2] * x + viewE[6] * y + viewE[10] * z + viewE[14]; } return o; };
    const ordered = [...meshes.filter(m => m.material.alphaMode !== 'BLEND'), ...meshes.filter(m => m.material.alphaMode === 'BLEND')];
    for (const m of ordered) {
      const blend = m.material.alphaMode === 'BLEND';
      const keep = []; for (let f = 0; f < m.I.length; f += 3) { const cx = (m.P[3 * m.I[f]] + m.P[3 * m.I[f + 1]] + m.P[3 * m.I[f + 2]]) / 3, cz = (m.P[3 * m.I[f] + 2] + m.P[3 * m.I[f + 1] + 2] + m.P[3 * m.I[f + 2] + 2]) / 3; if (blend || cx <= A.OpticRear[0] + 0.0005 || cz < -0.07 || cz > 0.1) keep.push(m.I[f], m.I[f + 1], m.I[f + 2]); }
      r2.draw(toView(m.P), keep, m.UV ? {uv: {data: m.UV, size: 2}} : null, blend ? () => [60, 140, 230, 0.55] : f => { const c = m.tex ? sample(m.tex, f.attrs.uv[0], f.attrs.uv[1]) : [128, 128, 128]; const sh = 0.55 + 0.45 * Math.abs(f.n[2]); return f.front ? [c[0] * sh, c[1] * sh, c[2] * sh, 1] : [70 + c[0] * 0.2, 70 + c[1] * 0.2, 80 + c[2] * 0.2, 1]; }, {cull: 'none', depthWrite: !blend});
    }
    const f2 = path.join(OUTDIR, `_mv-${name}-cut.png`);
    await r2.save(f2, {overlaySvg: `<svg width="${S}" height="${S}"><text x="10" y="24" font-size="15" fill="#a00" font-family="sans-serif">${name}: -X half of the scope cut at the axis (grey = cut/back faces, blue = glass)</text></svg>`}); out.push(f2);
  }
  const imgs = await Promise.all(out.map(f => sharp(f).toBuffer()));
  await sharp({create: {width: 2 * S, height: 2 * S, channels: 3, background: '#000'}}).composite([
    {input: imgs[0], left: 0, top: 0}, {input: imgs[2], left: S, top: 0}, {input: imgs[1], left: 0, top: S}, {input: imgs[3], left: S, top: S}]).png().toFile(path.join(OUTDIR, '06-optic-model-before-after.png'));
  for (const f of out) fs.unlinkSync(f);
}
await modelViews();
fs.writeFileSync(path.join(OUTDIR, 'qa-optic.json'), JSON.stringify(metrics, null, 1) + '\n');
console.log(JSON.stringify(metrics.ads, null, 1), JSON.stringify(los, null, 1));
