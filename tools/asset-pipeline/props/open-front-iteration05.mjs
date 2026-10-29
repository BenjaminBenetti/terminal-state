// The Last Line - iteration05 open-front derivatives of the iteration04 drinks cooler and countertop display case (user feedback item 4:
// "there is just a picture of drinks on the front ... the modeled items are behind the picture").
// Hybrid, CPU only: the iteration04 runtime derivative (itself baked from the preserved iteration04 native F16 SV master; sha256 verified
// against props-iteration04.json) keeps its reconstructed exterior shell (cabinet sides, header, grille, door frame, handle / stainless base,
// canopy, feet) with its baked textures. The projected stock picture on the opaque pane and everything inside the case volume are CUT, and
// authored, textured geometry is added: an interior liner, REAL wire shelves / trays at measured heights, a bezel hiding the cut edge,
// LED / heat-lamp strips (emissive), and a genuinely transparent glass pane (separate node 'glass', alphaMode BLEND) so the game's actual 3D
// stock items show through. Masters and the iteration04 derivatives are never modified; new files only.
// Exported: buildOpenFront(key, {REPO, guardedWrite, log}) -> provenance record. Used by build-props-iteration05.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {sha256File, sha256Buf} from './lib/dense.mjs';

const r3 = v => Math.round(v * 1e3) / 1e3;

// ---- authored atlas (256 px, 4 x 4 cells of 64 px; faces map into a cell inset by 6 px) -------------------------------------------------
// glTF metallicRoughness: G = roughness, B = metalness. Emissive only on light cells.
const CELLS = {
  liner: {i: 0, rgb: [192, 197, 196], noise: 9, grime: 0.22, rough: 0.62, metal: 0.0},
  wire: {i: 1, rgb: [158, 161, 164], noise: 6, rough: 0.34, metal: 0.85},
  bezel: {i: 2, rgb: [30, 31, 33], noise: 7, rough: 0.45, metal: 0.55},
  led: {i: 3, rgb: [236, 242, 250], noise: 2, rough: 0.3, metal: 0.0, emissive: [236, 242, 250]},
  steel: {i: 4, rgb: [146, 146, 141], noise: 6, brushed: true, grime: 0.18, rough: 0.38, metal: 0.88},
  heat: {i: 5, rgb: [255, 196, 128], noise: 2, rough: 0.3, metal: 0.0, emissive: [255, 168, 84]},
  deck: {i: 6, rgb: [205, 207, 203], noise: 8, grime: 0.28, rough: 0.55, metal: 0.0},
  standard: {i: 7, rgb: [74, 76, 78], noise: 5, rough: 0.5, metal: 0.6},
  steelDark: {i: 8, rgb: [96, 96, 92], noise: 7, brushed: true, grime: 0.2, rough: 0.42, metal: 0.85},
};
const AT = 256, CELL = 64, INSET = 6;
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
async function authoredAtlas() {
  const col = new Uint8Array(AT * AT * 3), mr = new Uint8Array(AT * AT * 3), em = new Uint8Array(AT * AT * 3);
  for (const [name, c] of Object.entries(CELLS)) {
    const cx = (c.i % 4) * CELL, cy = Math.floor(c.i / 4) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const o = 3 * ((cy + y) * AT + cx + x);
      // value noise (2 octaves) + optional brushed streaks + bottom grime gradient (v increases downward in the cell)
      const n = (hash(x >> 2, y >> 2, c.i) - 0.5) * 0.6 + (hash(x, y, c.i + 31) - 0.5) * 0.4;
      const b = c.brushed ? (hash(0, y, c.i + 77) - 0.5) * 0.8 : 0;
      const g = c.grime ? c.grime * Math.max(0, (y / CELL - 0.55) / 0.45) * (0.6 + 0.8 * hash(x >> 3, y >> 3, c.i + 5)) : 0;
      for (let k = 0; k < 3; k++) col[o + k] = Math.max(0, Math.min(255, Math.round(c.rgb[k] * (1 - g) + c.noise * (n + b))));
      mr[o] = 255; mr[o + 1] = Math.round(c.rough * 255 + (c.noise ? (hash(x >> 1, y >> 1, c.i + 9) - 0.5) * 18 : 0)); mr[o + 2] = Math.round(c.metal * 255);
      if (c.emissive) for (let k = 0; k < 3; k++) em[o + k] = c.emissive[k];
    }
  }
  const enc = async (raw, kind) => kind === 'png'
    ? sharp(Buffer.from(raw), {raw: {width: AT, height: AT, channels: 3}}).png({compressionLevel: 9}).toBuffer()
    : sharp(Buffer.from(raw), {raw: {width: AT, height: AT, channels: 3}}).jpeg({quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
  return {color: {mime: 'image/jpeg', bytes: await enc(col, 'jpg')}, orm: {mime: 'image/jpeg', bytes: await enc(mr, 'jpg')}, emissive: {mime: 'image/png', bytes: await enc(em, 'png')}};
}
const cellUV = name => { const c = CELLS[name], x0 = (c.i % 4) * CELL + INSET, y0 = Math.floor(c.i / 4) * CELL + INSET, s = CELL - 2 * INSET; return [x0 / AT, y0 / AT, (x0 + s) / AT, (y0 + s) / AT]; };

// ---- authored geometry builder -------------------------------------------------------------------------------------------------------
class Geo {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.parts = []; }
  quad(c, n, cell) {   // c: 4 corners CCW seen from the side the normal points to
    const [u0, v0, u1, v1] = cellUV(cell), base = this.pos.length / 3;
    const uvs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    for (let k = 0; k < 4; k++) { this.pos.push(...c[k]); this.nrm.push(...n); this.uv.push(...uvs[k]); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // axis-aligned box [x0,x1]x[y0,y1]x[z0,z1]; faces: subset of '+x-x+y-y+z-z' (outward); inward=true flips to face the inside
  box(name, [x0, y0, z0], [x1, y1, z1], cell, faces = '+x-x+y-y+z-z', inward = false) {
    const F = {
      '+x': [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]],
      '-x': [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
      '+y': [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
      '-y': [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]],
      '+z': [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
      '-z': [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
    };
    for (const f of faces.match(/[+-][xyz]/g)) { const [c, n] = F[f]; this.quad(inward ? [c[0], c[3], c[2], c[1]] : c, inward ? n.map(v => -v) : n, cell); }
    this.parts.push({name, min: [x0, y0, z0].map(r3), max: [x1, y1, z1].map(r3), cell, faces, inward});
  }
  get tris() { return this.idx.length / 3; }
}

// ---- source (iteration04 runtime derivative) -------------------------------------------------------------------------------------------
async function loadBaked(REPO, key, file) {
  const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/props-iteration04.json'), 'utf8')).outputs.find(o => o.key === key);
  const abs = path.join(REPO, file), sha = sha256File(abs);
  if (sha !== prov.sha256) throw new Error(`${key}: iteration04 derivative sha256 mismatch (${sha} != ${prov.sha256})`);
  const doc = await new NodeIO().read(abs);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0], mat = prim.getMaterial();
  return {prov, sha, bytes: fs.statSync(abs).size, P: prim.getAttribute('POSITION').getArray(), N: prim.getAttribute('NORMAL').getArray(), UV: prim.getAttribute('TEXCOORD_0').getArray(), I: prim.getIndices().getArray(),
    tex: {color: {mime: mat.getBaseColorTexture().getMimeType(), bytes: mat.getBaseColorTexture().getImage()}, orm: {mime: mat.getMetallicRoughnessTexture().getMimeType(), bytes: mat.getMetallicRoughnessTexture().getImage()},
      normal: mat.getNormalTexture() ? {mime: mat.getNormalTexture().getMimeType(), bytes: mat.getNormalTexture().getImage()} : null},
    metallic: mat.getMetallicFactor(), roughness: mat.getRoughnessFactor()};
}
// keep faces for which cut(centroid, normal) is false; compact vertices
function cutFaces(src, cut) {
  const {P, N, UV, I} = src, keep = [], map = new Int32Array(P.length / 3).fill(-1), pos = [], nrm = [], uv = []; let removed = 0, removedArea = 0;
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2];
    const C = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n) || 1;
    if (cut(C, n.map(v => v / l))) { removed++; removedArea += l / 2; continue; }
    for (const v of [I[f], I[f + 1], I[f + 2]]) {
      if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); nrm.push(N[3 * v], N[3 * v + 1], N[3 * v + 2]); uv.push(UV[2 * v], UV[2 * v + 1]); }
      keep.push(map[v]);
    }
  }
  return {pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: Float32Array.from(uv), idx: Uint32Array.from(keep), removed, removedAreaM2: r3(removedArea), kept: keep.length / 3};
}
const bboxOf = (...arrs) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const P of arrs) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } return {min: mn.map(r3), max: mx.map(r3), size: mx.map((v, k) => r3(v - mn[k]))}; };

// ---- per-asset specs ------------------------------------------------------------------------------------------------------------------
// Cooler (0.75 x 2.0 x 0.75, front +Z): iteration04 measured glass (image) x -0.295..0.293, y 0.269..1.687; pane plane z ~0.32 (double
// layer), sparse reconstructed bottles/junk at z -0.30..-0.08, cabinet back wall at z <= -0.33, door frame + handle at z >= 0.30;
// side walls are thin shells (outer faces |x| 0.33, inner 0.32) and are kept.
// Shelf tiers follow the game's existing SHOP_COOLER_TIER_Y [0.26, 0.66, 1.06, 1.46] (deck + three wire shelves) so loot needs no retune.
const COOLER = {
  key: 'shopCooler', src: 'game/public/assets/models/shop-cooler.glb', out: 'shop-cooler-open.glb',
  interior: {x: 0.3, yFloor: 0.26, yCeil: 1.7, zBack: -0.305, zGlass: 0.312}, tiers: [0.66, 1.06, 1.46],
  cut: ([x, y, z], n) => (z >= 0.295 && Math.abs(x) < 0.3 && y > 0.255 && y < 1.705)                         // door pane (projected picture)
    || (z > -0.31 && z < 0.295 && Math.abs(x) < 0.315 && y > 0.24 && y < 1.715)                                    // everything inside the case (side-wall shells at |x| 0.32-0.33 kept)
    || (z >= -0.33 && z <= -0.31 && Math.abs(x) < 0.315 && y > 0.24 && y < 1.715 && n[2] > -0.3),                  // inward/side faces near the back
  build(g, I) {
    const {x, yFloor, yCeil, zBack, zGlass} = I, zf = zGlass - 0.004;
    g.box('liner-back', [-x, yFloor, zBack - 0.01], [x, yCeil, zBack], 'liner', '+z');
    g.box('liner-left', [-x - 0.01, yFloor, zBack], [-x, yCeil, zf], 'liner', '+x');
    g.box('liner-right', [x, yFloor, zBack], [x + 0.01, yCeil, zf], 'liner', '-x');
    g.box('liner-ceiling', [-x, yCeil, zBack], [x, yCeil + 0.01, zf], 'liner', '-y');
    g.box('deck', [-x, yFloor - 0.012, zBack], [x, yFloor, zf], 'deck', '+y+z');     // bottom deck: top surface = tier 0.26
    // shelf standards (slotted uprights) in the four inner corners
    for (const sx of [-1, 1]) for (const zz of [zBack + 0.012, zf - 0.03]) g.box(`standard-${sx > 0 ? 'r' : 'l'}${zz < 0 ? 'b' : 'f'}`, [sx > 0 ? x - 0.018 : -x, yFloor, zz - 0.012], [sx > 0 ? x : -x + 0.018, yCeil, zz + 0.012], 'standard', sx > 0 ? '-x+z-z' : '+x+z-z');
    // wire shelves: top of rods = tier height; 11 front-to-back rods, front lip bar, back bar, two side rails
    const z0 = zBack + 0.012, z1 = zf - 0.045, rod = 0.006;
    for (const ty of this.tiers) {
      const t = `shelf-${ty}`;
      for (let k = 0; k <= 10; k++) { const cx = -x + 0.03 + k * (2 * x - 0.06) / 10; g.box(`${t}-rod${k}`, [cx - rod / 2, ty - rod, z0], [cx + rod / 2, ty, z1], 'wire', '+x-x+y-y+z'); }
      g.box(`${t}-lip`, [-x + 0.004, ty - 0.012, z1], [x - 0.004, ty + 0.018, z1 + 0.012], 'wire');          // front price-channel lip, 1.8 cm above the deck
      g.box(`${t}-back`, [-x + 0.004, ty - 0.016, z0 - 0.008], [x - 0.004, ty - rod, z0], 'wire', '+y-y+z');
      for (const sx of [-1, 1]) g.box(`${t}-rail${sx}`, [sx > 0 ? x - 0.014 : -x + 0.004, ty - 0.02, z0], [sx > 0 ? x - 0.004 : -x + 0.014, ty - rod, z1], 'wire', '+y-y' + (sx > 0 ? '-x' : '+x'));
    }
    g.box('led-strip', [-x + 0.03, yCeil - 0.012, zf - 0.05], [x - 0.03, yCeil, zf - 0.025], 'led', '-y+z');
    // bezel (black aluminium door frame) hiding the cut edge of the reconstructed door; front face at z 0.338 (door front ~0.33)
    const bz0 = zGlass - 0.006, bz1 = 0.338, bo = 0.322, bi = 0.288;
    g.box('bezel-bottom', [-bo, 0.236, bz0], [bo, 0.272, bz1], 'bezel', '+y+z');
    g.box('bezel-top', [-bo, 1.684, bz0], [bo, 1.72, bz1], 'bezel', '-y+z');
    g.box('bezel-left', [-bo, 0.272, bz0], [-bi, 1.684, bz1], 'bezel', '+x+z');
    g.box('bezel-right', [bi, 0.272, bz0], [bo, 1.684, bz1], 'bezel', '-x+z');
  },
  glass: I => [{name: 'glass-door', c: [[-0.3, 0.255, I.zGlass], [0.3, 0.255, I.zGlass], [0.3, 1.705, I.zGlass], [-0.3, 1.705, I.zGlass]], n: [0, 0, 1]}],
  surfaces: I => [
    {name: 'deck', y: I.yFloor, x0: -I.x, x1: I.x, z0: I.zBack, z1: I.zGlass - 0.004 - 0.045, clearTo: 0.66 - 0.02},
    ...[0.66, 1.06, 1.46].map((ty, i, a) => ({name: `wireShelf${i + 1}`, y: ty, x0: -I.x + 0.014, x1: I.x - 0.014, z0: I.zBack + 0.012, z1: I.zGlass - 0.004 - 0.045, clearTo: (a[i + 1] ?? I.yCeil) - 0.02})),
  ],
};
// Display (1.10 x 0.70 x 0.62 countertop unit, front +Z): base 0..~0.21 (control knob +X), glass band ~0.21..0.63, canopy ~0.63..0.70.
// iteration04: front pane z ~0.26, a second opaque layer z ~-0.18, back z ~-0.28, reconstructed pans/racks with baked picture between.
// The whole band is cut and rebuilt: lower stainless tray, upper wire rack + tray, glass on all four sides, corner posts, rails, heat lamps.
const DISPLAY = {
  key: 'shopDisplay', src: 'game/public/assets/models/shop-display.glb', out: 'shop-display-open.glb',
  interior: {x: 0.52, z: 0.27, yLow: 0.214, yMid: 0.427, yCeil: 0.628},
  cut: ([x, y, z]) => y > 0.217 && y < 0.624,
  build(g, I) {
    const {x, z, yLow, yMid, yCeil} = I, X = 0.548, Z = 0.305;
    g.box('base-cap', [-X, yLow - 0.012, -Z], [X, yLow, Z], 'steel', '+y+x-x+z-z');                 // caps the cut base: lower deck
    g.box('lower-tray', [-x + 0.01, yLow, -z + 0.02], [x - 0.01, yLow + 0.006, z - 0.03], 'steelDark', '+y');
    for (const [nm, a, b] of [['lip-f', [-x + 0.01, yLow, z - 0.034], [x - 0.01, yLow + 0.02, z - 0.03]], ['lip-b', [-x + 0.01, yLow, -z + 0.02], [x - 0.01, yLow + 0.02, -z + 0.024]]]) g.box(`lower-${nm}`, a, b, 'steel', '+y+z-z');
    // upper wire rack (rod tops = yMid) with a shallow tray on it
    const rod = 0.005, z0 = -z + 0.02, z1 = z - 0.03;
    for (let k = 0; k <= 16; k++) { const cx = -x + 0.02 + k * (2 * x - 0.04) / 16; g.box(`rack-rod${k}`, [cx - rod / 2, yMid - rod, z0], [cx + rod / 2, yMid, z1], 'wire', '+x-x+y-y'); }
    for (const [nm, zz] of [['front', z1], ['back', z0]]) g.box(`rack-${nm}`, [-x + 0.01, yMid - 0.014, zz - 0.004], [x - 0.01, yMid, zz + 0.004], 'wire');
    g.box('rack-tray', [-x + 0.03, yMid, -z + 0.035], [x - 0.03, yMid + 0.005, z - 0.045], 'steelDark', '+y-y');
    for (const sx of [-1, 1]) g.box(`rack-side${sx}`, [sx > 0 ? x - 0.012 : -x, yMid - 0.02, z0], [sx > 0 ? x : -x + 0.012, yMid, z1], 'wire', '+y-y+x-x');
    g.box('canopy-underside', [-X, yCeil, -Z], [X, yCeil + 0.012, Z], 'steel', '-y+x-x+z-z');
    for (const zz of [z - 0.06, -z + 0.06]) g.box(`heat-lamp-${zz > 0 ? 'f' : 'b'}`, [-x + 0.06, yCeil - 0.01, zz - 0.012], [x - 0.06, yCeil, zz + 0.012], 'heat', '-y+z-z');
    // corner posts + bottom/top rails (stainless) framing the glass
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(`post-${sx}${sz}`, [sx > 0 ? X - 0.026 : -X, yLow, sz > 0 ? Z - 0.026 : -Z], [sx > 0 ? X : -X + 0.026, yCeil, sz > 0 ? Z : -Z + 0.026], 'steel', '+x-x+z-z');
    for (const sz of [-1, 1]) for (const [nm, y0, y1] of [['b', yLow, yLow + 0.02], ['t', yCeil - 0.02, yCeil]]) g.box(`rail-${nm}${sz}`, [-X + 0.026, y0, sz > 0 ? Z - 0.014 : -Z], [X - 0.026, y1, sz > 0 ? Z : -Z + 0.014], 'steel', sz > 0 ? '+z+y-y' : '-z+y-y');
  },
  glass: I => {
    const X = 0.536, Z = 0.293, y0 = I.yLow + 0.02, y1 = I.yCeil - 0.02;
    return [{name: 'glass-front', c: [[-X, y0, Z], [X, y0, Z], [X, y1, Z], [-X, y1, Z]], n: [0, 0, 1]}, {name: 'glass-back', c: [[X, y0, -Z], [-X, y0, -Z], [-X, y1, -Z], [X, y1, -Z]], n: [0, 0, -1]},
      {name: 'glass-right', c: [[X, y0, Z], [X, y0, -Z], [X, y1, -Z], [X, y1, Z]], n: [1, 0, 0]}, {name: 'glass-left', c: [[-X, y0, -Z], [-X, y0, Z], [-X, y1, Z], [-X, y1, -Z]], n: [-1, 0, 0]}];
  },
  surfaces: I => [
    {name: 'lowerTray', y: r3(I.yLow + 0.006), x0: -I.x + 0.01, x1: I.x - 0.01, z0: -I.z + 0.024, z1: I.z - 0.034, clearTo: I.yMid - 0.02},
    {name: 'upperRackTray', y: r3(I.yMid + 0.005), x0: -I.x + 0.03, x1: I.x - 0.03, z0: -I.z + 0.035, z1: I.z - 0.045, clearTo: I.yCeil - 0.012},
  ],
};
export const OPEN_FRONT = {shopCoolerOpen: COOLER, shopDisplayOpen: DISPLAY};

export async function buildOpenFront(name, {REPO, guardedWrite, log, outDir}) {
  const S = OPEN_FRONT[name];
  const src = await loadBaked(REPO, S.key, S.src);
  const status = 'prototype hybrid derivative: iteration04 reconstructed exterior (unapproved AI master, CPU-baked) + authored interior/shelves/glass; reviewStatus unapproved; gameReady false; no license clearance';
  const {bytes, body, g, gidx, bbOut, surfaces} = await assembleOpenFront(S, src, bb => ({sourceId: `iteration05-${S.key}-open`, derivedFrom: S.src, derivedFromSha256: src.sha, nativeJobId: src.prov.source.nativeJobId, units: 'meters', front: '+Z', origin: 'bottom-centre',
    provisionalDimensionsMeters: bb.size, status, pipeline: 'tools/asset-pipeline/props/build-props-iteration05.mjs (open-front-iteration05.mjs)', glassNode: 'glass (alphaMode BLEND; decorative only, never blocks item picking)'}));
  return openFrontRecord(name, S, src, {bytes, body, g, gidx, bbOut, surfaces, written: guardedWrite(path.join(outDir, S.out), bytes), log});
}

/**
 * The hybrid itself (shared with build-meshy-t25.mjs, which passes a Meshy T2.5 exterior as `src`): cut the source mesh by S.cut,
 * add the authored interior (S.build) and glass (S.glass); the bbox must stay the source's. `extras(bbOut)` -> root node extras
 * (interiorSurfaces is appended). Returns the GLB bytes and the parts for the provenance record.
 */
export async function assembleOpenFront(S, src, extras) {
  const body = cutFaces(src, S.cut);
  const g = new Geo(); S.build(g, S.interior);
  const glass = S.glass(S.interior);
  const gpos = [], gnrm = [], gidx = [];
  for (const q of glass) { const b = gpos.length / 3; for (const c of q.c) { gpos.push(...c); gnrm.push(...q.n); } gidx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const bbSrc = bboxOf(src.P), bbOut = bboxOf(body.pos, Float32Array.from(g.pos), Float32Array.from(gpos));
  for (let k = 0; k < 3; k++) if (Math.abs(bbSrc.min[k] - bbOut.min[k]) > 0.002 || Math.abs(bbSrc.max[k] - bbOut.max[k]) > 0.002) throw new Error(`${S.key}: bbox changed ${JSON.stringify(bbSrc)} -> ${JSON.stringify(bbOut)} (the game fits the model bbox to PROP_DEFS; must stay identical)`);
  const atlas = await authoredAtlas();
  // ---- write GLB: root node <key> with children body / interior / glass --------------------------------------------------------------
  const doc = new Document(), buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const tex = (n, t) => doc.createTexture(n).setImage(new Uint8Array(t.bytes)).setMimeType(t.mime);
  const prim = (P, N, UV, I, mat) => { const p = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)); if (UV) p.setAttribute('TEXCOORD_0', acc('VEC2', UV)); return p.setIndices(acc('SCALAR', P.length / 3 <= 65535 ? Uint16Array.from(I) : Uint32Array.from(I))).setMaterial(mat); };
  const mBody = doc.createMaterial(`${S.key}-open-baked`).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(src.metallic).setRoughnessFactor(src.roughness)
    .setBaseColorTexture(tex(`${S.key}-color`, src.tex.color)).setMetallicRoughnessTexture(tex(`${S.key}-orm`, src.tex.orm));
  if (src.tex.normal) mBody.setNormalTexture(tex(`${S.key}-normal`, src.tex.normal));
  const mInt = doc.createMaterial(`${S.key}-open-authored`).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(1)
    .setBaseColorTexture(tex('authored-color', atlas.color)).setMetallicRoughnessTexture(tex('authored-orm', atlas.orm)).setEmissiveTexture(tex('authored-emissive', atlas.emissive)).setEmissiveFactor([1, 1, 1]);
  const mGlass = doc.createMaterial(`${S.key}-open-glass`).setBaseColorFactor([0.8, 0.88, 0.9, 0.14]).setMetallicFactor(0).setRoughnessFactor(0.06).setAlphaMode('BLEND').setDoubleSided(true);
  const root = doc.createNode(`${S.key}Open`);
  root.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim(body.pos, body.nrm, body.uv, body.idx, mBody))));
  root.addChild(doc.createNode('interior').setMesh(doc.createMesh('interior').addPrimitive(prim(Float32Array.from(g.pos), Float32Array.from(g.nrm), Float32Array.from(g.uv), g.idx, mInt))));
  root.addChild(doc.createNode('glass').setMesh(doc.createMesh('glass').addPrimitive(prim(Float32Array.from(gpos), Float32Array.from(gnrm), null, gidx, mGlass))));
  const surfaces = S.surfaces(S.interior).map(s => ({...s, y: r3(s.y), x0: r3(s.x0), x1: r3(s.x1), z0: r3(s.z0), z1: r3(s.z1), clearTo: r3(s.clearTo), clearM: r3(s.clearTo - s.y)}));
  root.setExtras({...extras(bbOut), interiorSurfaces: surfaces});
  doc.getRoot().setDefaultScene(doc.createScene('Scene').addChild(root));
  const bytes = Buffer.from(await new NodeIO().writeBinary(doc));
  return {bytes, body, g, gidx, bbOut, surfaces};
}

function openFrontRecord(name, S, src, {bytes, body, g, gidx, bbOut, surfaces, written, log}) {
  void bytes;
  const tris = body.kept + g.tris + gidx.length / 3;
  log(`  ${name}: cut ${body.removed} faces (${body.removedAreaM2} m2) of ${src.I.length / 3}; kept ${body.kept}; authored ${g.tris} tris (${g.parts.length} parts); glass ${gidx.length / 3}; total ${tris}; ${written.bytes} bytes; bbox ${JSON.stringify(bbOut.size)}`);
  return {
    output: written.path, key: name, modelKey: S.key, replaces: S.src, bytes: written.bytes, sha256: written.sha256, triangles: tris,
    trianglesByNode: {body: body.kept, interior: g.tris, glass: gidx.length / 3},
    textures: {body: 'iteration04 baked atlas reused byte-identical (colour 1024 JPEG, MR 512 JPEG, normal 512 PNG)', authored: `${AT} px atlas (colour JPEG, MR JPEG, emissive PNG), procedural value-noise/brushed/grime swatches`, glass: 'none (factor only)'},
    materials: {[`${S.key}-open-baked`]: 'reconstructed exterior (opaque)', [`${S.key}-open-authored`]: 'interior liner / shelves / bezel / posts; emissive LED or heat-lamp strip via emissive map (scale with emissiveIntensity if needed)', [`${S.key}-open-glass`]: 'transparent glass: baseColor (0.8,0.88,0.9) alpha 0.14, roughness 0.06, BLEND, double-sided'},
    nodes: ['body', 'interior', 'glass'],
    source: {derivative: S.src, derivativeSha256: src.sha, derivativeSha256Verified: true, derivativeProvenance: 'game/public/assets/derivatives/props-iteration04.json', nativeJobId: src.prov.source.nativeJobId, preservedMaster: src.prov.source.preservedMaster, conditioningImage: src.prov.source.conditioningImage, reviewStatus: 'unapproved', gameReady: false},
    dimensionsMeters: {bbox: bbOut, measured: {w: bbOut.size[0], h: bbOut.size[1], d: bbOut.size[2]}, note: 'identical to the iteration04 derivative bbox (asserted), so the game fit (PROP_DEFS / SHOP_DISPLAY_CASE) is unchanged'},
    conventions: {units: 'meters', front: '+Z', up: '+Y', origin: 'bottom-center'},
    interior: S.interior, interiorSurfaces: surfaces, authoredParts: g.parts.length,
    cut: {removedFaces: body.removed, removedAreaM2: body.removedAreaM2, keptFaces: body.kept, rule: S.cut.toString()},
    pipeline: [
      {step: 'verify-source', detail: `sha256 of ${S.src} == props-iteration04.json record (derivative of the preserved iteration04 native F16 SV master ${src.prov.source.nativeJobId})`},
      {step: 'cut', detail: 'remove every reconstructed face whose centroid lies in the opaque pane / case volume (the projected stock picture and the reconstructed interior); exterior shell faces kept with their baked texels'},
      {step: 'author', detail: 'textured boxes: interior liner, deck/trays, real wire shelves (rod tops at the listed heights), shelf standards / posts, bezel or rails hiding the cut edge, emissive light strips'},
      {step: 'glass', detail: 'transparent pane(s) as a separate node "glass" (BLEND alpha 0.14): genuinely see-through, no picture'},
      {step: 'encode', detail: 'plain glTF 2.0 binary, three nodes / three materials, no extensions'},
    ],
    limitations: [
      'Hybrid prototype: reconstructed exterior from a single straight-on AI view (sides/back inferred, see the iteration04 limitations) + simple authored interior; unapproved, gameReady false.',
      'Glass is a plain alpha-blended pane (no refraction/reflection probe); three.js sorts per object, so overlapping panes of one case blend in a fixed order (low alpha keeps this subtle).',
      'Interior emissive strips glow regardless of scene lighting (practical light look); stock items inside are lit only by the scene lights.',
      ...(name === 'shopCoolerOpen' ? ['Reconstructed door frame/handle kept; the authored bezel is a 3.4 cm black frame slightly proud (z 0.338) of the reconstructed door face to hide the cut edge.'] : ['The reconstructed pans/racks were removed with the opaque glass band; trays are authored flat stainless sheets (no food-pan wells).']),
    ],
  };
}
