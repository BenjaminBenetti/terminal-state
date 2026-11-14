// Task studio-corpse-market-shop-20261114-031614-01 (lane ASSET): the runtime derivatives of THE CORPSE BUYER'S DEN's two Meshy T2.5
// props — the floor body chute and the buyer's barred booth — cooked the way the Bunker kit is (build-bunker-kit.mjs).
//
// Reads (never modifies) the private task records (lib/corpse-shop-records.mjs: the finance ledger, the Codex result rows, the immutable
// masters; every master / conditioning image verified by sha256 first) and writes deterministically:
//   game/public/assets/models/market-corpse-{chute,booth}.glb      Market-only (assets/levelAssets.ts LEVEL_ONLY_RULES 'market-*')
//   game/public/assets/derivatives/corpse-shop-kit-20261114.json    provenance (hash-only: no URLs / tokens / local paths)
//   game/src/assets/corpseShopKit.generated.ts                      {key, url, bytes, tris, dims, rimY / throat | counterY / counterZ}
//   tools/release/public-inputs.json                                ONLY this script's paths added / updated (+ CREDITS.md)
//   game/public/assets/CREDITS.md                                   the marked corpse-shop section (shared with build-corpse-buyer.mjs)
//
// Derivatives: Meshy's native frame kept (front +Z as generated), ONE uniform scale to the real size (KIT below), grounded (min y = 0),
// centred on x / z, baked into the vertices; no geometry simplification (smart topology made them at ~7.5 k triangles). Meshy's PBR
// maps are KEPT channel for channel (the master's own base colour / packed metallic-roughness / normal; no reprojection / retexture /
// repaint), only resized / re-encoded to JPEG.
// Measured surfaces (from the cooked geometry, recorded in the registry for the den's runtime and PropDefs):
//   chute rimY     = the hopper rim's top (the highest point of the FRONT half: the lid stands along the back edge) — what a body is
//                    lifted over;
//   booth counterY = the customer side's counter top (median height of the visible up-facing top in front of the bar line, between
//                    0.25 and 0.6 of the height), counterZ = how far the counter's front edge reaches toward +Z from the model centre;
//   (provenance only) the chute's hopper footprint / centre and its open throat, the booth counter's front-edge / bar-line heights.
//
//   node tools/asset-pipeline/props/build-corpse-shop-kit.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';
import {ROOT, TASK, PUB, KIT_PROV_REL, sha, verifyMaster, assertPublicSafe, writeCredits, updateAllowlist} from './lib/corpse-shop-records.mjs';

const REG = path.join(ROOT, 'game/src/assets/corpseShopKit.generated.ts');
const DRY = process.argv.includes('--dry-run');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The kit. size: how the ONE uniform scale is chosen (root CLAUDE.md props rule 5; checked beside a runtime zombie with
 * tools/asset-pipeline/props/scale-check.mjs --kind corpseChute / corpseBooth):
 *  - chute: the hopper ~1.0 m across (x) -> its rim lands knee high (~0.57 m);
 *  - booth: the counter top at a real counter height (nominal 0.90 m: typical counters 0.9-1.0 m) inside the den's slot of <= 2.3 m
 *    wide / <= 0.5 m deep. At exactly 0.90 m the screen would be 2.31 m wide (its side posts' foot plates), so the 2.3 m width
 *    binds and the counter lands at ~0.896 m (the cook asserts >= 0.89 m). The reconstructed slab slopes a little toward the
 *    customer (~0.91 m at the bar line, ~0.88 m at its front edge: recorded in the provenance).
 * tex: [base colour, metallicRoughness, normal] px. The booth is the den's interaction surface (the player stands at its counter, the
 * buyer behind its bars) across 2.3 m, so its base colour keeps Meshy's full 2048 and its normal 1024; the ~1 m chute 1024 / 512 / 512.
 */
const KIT = [
  {asset: 'CORPSE_CHUTE', key: 'chute', name: 'market-corpse-chute', size: {by: 'width', m: 1.0}, tex: [1024, 512, 512],
    what: 'the corpse buyer\'s floor body chute: a square welded steel hopper (riveted sloping walls, a rolled rim lip with a hazard band, a dark shaft below the throat), its strap-hinged lid standing open along the back edge; bolted down at the four corners'},
  {asset: 'CORPSE_BOOTH', key: 'booth', name: 'market-corpse-booth', size: {by: 'counter', m: 0.9, maxW: 2.3, maxD: 0.5, minCounter: 0.89}, tex: [2048, 512, 1024],
    what: 'the corpse buyer\'s barred booth front: a welded steel screen of thick square bars with open gaps over a steel counter on a riveted plate, side posts, a header beam with a caged red work lamp'},
];

// ---------------------------------------------------------------- geometry measures (positions baked: every node transform cleared)
function triangles(root) {
  const out = [];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray(), idx = p.getIndices()?.getArray();
    const n = idx ? idx.length : pos.length / 3;
    for (let t = 0; t < n; t += 3) for (let k = 0; k < 3; k++) { const i = idx ? idx[t + k] : t + k; out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
  }
  return Float32Array.from(out);
}

/** Up-facing horizontal triangles (geometric normal y > 0.9): area histogram by height in `bin` steps between y0 and y1. */
function upSurfaces(T, y0, y1, bin) {
  const hist = new Map(), tris = [];
  for (let t = 0; t < T.length; t += 9) {
    const ax = T[t + 3] - T[t], ay = T[t + 4] - T[t + 1], az = T[t + 5] - T[t + 2], bx = T[t + 6] - T[t], by = T[t + 7] - T[t + 1], bz = T[t + 8] - T[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l < 0.9) continue;
    const y = (T[t + 1] + T[t + 4] + T[t + 7]) / 3;
    if (y < y0 || y > y1) continue;
    const k = Math.floor(y / bin);
    hist.set(k, (hist.get(k) ?? 0) + l / 2);
    tris.push({y, a: l / 2, t});
  }
  return {hist, tris};
}

/** The broadest up-facing plateau in [y0, y1]: its area-weighted height (+-1.5 bins around the peak bin) and its triangles. */
function plateau(T, y0, y1, bin = 0.005) {
  const {hist, tris} = upSurfaces(T, y0, y1, bin);
  let best = null;
  for (const [k, a] of hist) if (!best || a > best.a) best = {k, a};
  if (!best) throw new Error(`no up-facing surface between ${y0} and ${y1}`);
  const yc = (best.k + 0.5) * bin, near = tris.filter(q => Math.abs(q.y - yc) <= 1.5 * bin);
  const area = near.reduce((s, q) => s + q.a, 0);
  return {y: near.reduce((s, q) => s + q.y * q.a, 0) / area, area, tris: near};
}

/**
 * Top-down height map of the up-facing horizontal triangles (normal y > 0.9) with heights in [y0, y1]: 1 cm cells keep the HIGHEST
 * such surface over them (what is visible from above; a reconstruction's doubled / buried slab faces drop out). Cells pass `keep(x, z)`.
 * Returns the broadest surface: the cells within `spread` of the 1 cm peak bin (cells are equal-area; `spread` lets a gently sloped top
 * count as one surface), their median height and the cells.
 */
function topSurface(T, y0, y1, keep, {cell = 0.01, spread = 0.04} = {}) {
  const top = new Map();
  for (let t = 0; t < T.length; t += 9) {
    const ax = T[t + 3] - T[t], ay = T[t + 4] - T[t + 1], az = T[t + 5] - T[t + 2], bx = T[t + 6] - T[t], by = T[t + 7] - T[t + 1], bz = T[t + 8] - T[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l < 0.9) continue;
    const ymin = Math.min(T[t + 1], T[t + 4], T[t + 7]), ymax = Math.max(T[t + 1], T[t + 4], T[t + 7]);
    if (ymax < y0 || ymin > y1) continue;
    // barycentric samples at <= half a cell spacing
    const edge = Math.max(Math.hypot(ax, az), Math.hypot(bx, bz), Math.hypot(T[t + 6] - T[t + 3], T[t + 8] - T[t + 5]));
    const n = Math.max(1, Math.ceil(edge / (cell / 2)));
    for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
      const u = i / n, v = j / n, x = T[t] + u * ax + v * bx, y = T[t + 1] + u * ay + v * by, z = T[t + 2] + u * az + v * bz;
      if (y < y0 || y > y1 || !keep(x, z)) continue;
      const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      const e = top.get(k);
      if (!e || y > e.y) top.set(k, {y, x, z});
    }
  }
  const hist = new Map();
  for (const e of top.values()) { const b = Math.floor(e.y / 0.01); hist.set(b, (hist.get(b) ?? 0) + 1); }
  let best = null;
  for (const [b, c] of hist) if (!best || c > best.c) best = {b, c};
  if (!best) throw new Error(`no up-facing surface between ${y0} and ${y1}`);
  const yc = (best.b + 0.5) * 0.01, cells = [...top.values()].filter(e => Math.abs(e.y - yc) <= spread);
  const med = a => { const s = [...a].sort((p, q) => p - q); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  return {y: med(cells.map(e => e.y)), areaM2: cells.length * cell * cell, cells, med};
}

/** Extent of the geometry (vertices) inside a height band: {x: [min, max], z: [min, max]}. */
function bandExtent(T, y0, y1) {
  const e = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]};
  for (let i = 0; i < T.length; i += 3) if (T[i + 1] >= y0 && T[i + 1] <= y1) {
    e.x[0] = Math.min(e.x[0], T[i]); e.x[1] = Math.max(e.x[1], T[i]); e.z[0] = Math.min(e.z[0], T[i + 2]); e.z[1] = Math.max(e.z[1], T[i + 2]);
  }
  return e;
}

/** The measured surfaces of a cooked model (grounded, centred, metres). */
function measure(key, T, dims) {
  const r4 = v => +v.toFixed(4);
  if (key === 'chute') {
    // the rim: the highest point of the front half (z > 0; the open lid stands along the back edge)
    let rim = -Infinity;
    for (let i = 0; i < T.length; i += 3) if (T[i + 2] > 0 && T[i + 1] > rim) rim = T[i + 1];
    const lip = plateau(T, 0.3 * dims[1], 0.75 * dims[1]);
    const span = bandExtent(T, rim - 0.04, rim + 1e-4);
    // the hopper body (below its rim the open lid is absent): its footprint / centre; the lid's lean behind it makes the bounding box
    // deeper than the hopper, so the hopper sits forward of the model centre
    const hop = bandExtent(T, 0.05, rim - 0.05), hc = [(hop.x[0] + hop.x[1]) / 2, (hop.z[0] + hop.z[1]) / 2];
    // the throat: the opening seen straight down (1 cm top-down coverage of every triangle), grown from the hopper centre until covered
    const cell = 0.01, cov = new Set();
    for (let t = 0; t < T.length; t += 9) {
      const ax = T[t + 3] - T[t], az = T[t + 5] - T[t + 2], bx = T[t + 6] - T[t], bz = T[t + 8] - T[t + 2];
      const n = Math.max(1, Math.ceil(Math.max(Math.hypot(ax, az), Math.hypot(bx, bz), Math.hypot(T[t + 6] - T[t + 3], T[t + 8] - T[t + 5])) / (cell / 2)));
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) cov.add(`${Math.floor((T[t] + i / n * ax + j / n * bx) / cell)},${Math.floor((T[t + 2] + i / n * az + j / n * bz) / cell)}`);
    }
    const open = (x, z) => !cov.has(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!open(hc[0], hc[1])) throw new Error('chute: no open throat under the hopper centre');
    const reach = (dx, dz) => { let d = 0; while (d < 1 && open(hc[0] + dx * (d + cell), hc[1] + dz * (d + cell))) d += cell; return d; };
    const th = {x: [hc[0] - reach(-1, 0), hc[0] + reach(1, 0)], z: [hc[1] - reach(0, -1), hc[1] + reach(0, 1)]};
    // the throat's height: the lowest geometry within 3 cm outside its rectangle (the sloping inner walls' bottom edge)
    let throatY = Infinity;
    for (let i = 0; i < T.length; i += 3) {
      const ox = Math.max(th.x[0] - T[i], T[i] - th.x[1], 0), oz = Math.max(th.z[0] - T[i + 2], T[i + 2] - th.z[1], 0);
      if (Math.max(ox, oz) <= 0.03 && T[i + 1] < throatY) throatY = T[i + 1];
    }
    return {rimY: r4(rim), detail: {rimTopPlateauY: r4(lip.y), rimTopPlateauAreaM2: r4(lip.area), rimSpanXZ: [r4(span.x[1] - span.x[0]), r4(span.z[1] - span.z[0])],
      hopperX: hop.x.map(r4), hopperZ: hop.z.map(r4), hopperCentreXZ: hc.map(r4), throatX: th.x.map(r4), throatZ: th.z.map(r4), throatY: r4(throatY),
      throatNote: 'the throat is OPEN geometry (no shaft floor is modelled): straight down through it the floor under the chute shows',
      method: 'rimY = highest vertex of the front half (z > 0); rimTopPlateauY = broadest up-facing horizontal plateau (normal y > 0.9) between 0.3 and 0.75 of the height (cross-check); rimSpanXZ = geometry extent in the 4 cm band under the rim top; hopper = geometry extent between 5 cm and 5 cm under the rim; throat = the open rectangle of a 1 cm top-down coverage map grown from the hopper centre, throatY = the lowest geometry within 3 cm outside it'}};
  }
  const top = boothCounter(T, dims[1]);
  // the slab top slopes down toward the customer: its height at the front edge (the frontmost 2 cm of cells) and at the bar line
  // (the rearmost 2 cm of the customer side), and the slope between them
  const zs = top.cells.map(e => e.z), zMax = Math.max(...zs), zMin = Math.min(...zs);
  const edgeY = top.med(top.cells.filter(e => e.z >= zMax - 0.02).map(e => e.y)), lineY = top.med(top.cells.filter(e => e.z <= zMin + 0.02).map(e => e.y));
  // the counter's front edge: the farthest +z of the slab (the band from 8 cm under its top to 1 cm over it)
  const band = bandExtent(T, top.y - 0.08, top.y + 0.01);
  const topX = [Math.min(...top.cells.map(e => e.x)), Math.max(...top.cells.map(e => e.x))];
  return {counterY: r4(top.y), counterZ: r4(band.z[1]), detail: {counterTopAreaM2: r4(top.areaM2), counterTopX: topX.map(r4), counterTopZ: [r4(zMin), r4(zMax)], counterBandX: band.x.map(r4),
    counterFrontEdgeY: r4(edgeY), counterBarLineY: r4(lineY), counterSlopeDeg: +(Math.atan2(lineY - edgeY, zMax - zMin - 0.02) * 180 / Math.PI).toFixed(1),
    method: 'counterY = the customer side\'s counter top: median height of a 1 cm top-down height map of the up-facing horizontal faces (normal y > 0.9; the highest face per cell) between 0.25 and 0.6 of the height, in front of the model centre (z > 0), cells within 4 cm of the 1 cm peak bin; counterFrontEdgeY / counterBarLineY = the same at its frontmost / rearmost 2 cm (the reconstructed slab slopes down toward the customer); counterZ = farthest +z of the geometry from 8 cm under to 1 cm over the top (the slab\'s front edge)'}};
}

/** The booth's customer-side counter top (z > 0: in front of the model centre / the bar line). */
const boothCounter = (T, H) => topSurface(T, 0.25 * H, 0.6 * H, (x, z) => z > 0);

// ---------------------------------------------------------------- cook
const out = [];
for (const k of KIT) {
  const {file, record} = verifyMaster(k.asset);
  const bytes = fs.readFileSync(file);
  const doc = await io.readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const raw = [0, 1, 2].map(i => b0.max[i] - b0.min[i]);
  // the uniform scale
  let s;
  if (k.size.by === 'width') s = k.size.m / raw[0];
  else {
    // measure the counter in metres at the largest scale the den's slot allows (grounded, centred), then scale it to its nominal
    // height; the slot's width / depth cap the scale (asserted to stay within a few mm of the nominal counter height)
    const s0 = Math.min(k.size.maxW / raw[0], k.size.maxD / raw[2]);
    const T0 = triangles(r);
    for (let i = 0; i < T0.length; i += 3) { T0[i] = (T0[i] - (b0.min[0] + b0.max[0]) / 2) * s0; T0[i + 1] = (T0[i + 1] - b0.min[1]) * s0; T0[i + 2] = (T0[i + 2] - (b0.min[2] + b0.max[2]) / 2) * s0; }
    const c0 = boothCounter(T0, raw[1] * s0).y;
    s = Math.min(s0, s0 * k.size.m / c0);
    if (c0 * s / s0 < k.size.minCounter) throw new Error(`${k.asset}: the ${k.size.maxW} x ${k.size.maxD} m slot puts the counter at ${(c0 * s / s0).toFixed(3)} m (< ${k.size.minCounter})`);
  }
  for (const m of r.listMeshes()) transformMesh(m, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const b1 = getBounds(scene);
  for (const m of r.listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1]);
  r.listMeshes().forEach((m, i) => m.setName(i ? `${k.name}-${i}` : k.name));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${k.name}-${i}` : k.name));
  r.listMaterials().forEach((m, i) => m.setName(i ? `${k.name}-${i}` : k.name));
  const [tb, tmr, tn] = k.tex;
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tb, tb], quality: 86, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tmr, tmr], quality: 86, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tn, tn], quality: 90, slots: /^normal/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-corpse-shop-kit.mjs (glTF-Transform)';
  const glb = Buffer.from(await io.writeBinary(doc));
  // re-read the written file: every number below is the shipped file's
  const d2 = await io.readBinary(new Uint8Array(glb));
  const bb = getBounds(d2.getRoot().getDefaultScene() ?? d2.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(i => +(bb.max[i] - bb.min[i]).toFixed(4));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 3e-3 || Math.abs(bb.min[2] + bb.max[2]) > 3e-3) throw new Error(`${k.asset}: not grounded / centred`);
  const T = triangles(d2.getRoot());
  const surf = measure(k.key, T, dims);
  const tris = T.length / 9;
  const mats = d2.getRoot().listMaterials();
  const textures = d2.getRoot().listTextures().map(t => ({
    slot: mats.flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]).find(([, x]) => x === t)?.[0] ?? 'unused',
    size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength,
  }));
  if (textures.length !== 3 || textures.some(t => t.slot === 'unused')) throw new Error(`${k.asset}: expected the three Meshy maps, got ${JSON.stringify(textures)}`);
  const {detail, ...surfaces} = surf;
  out.push({key: k.key, modelKey: k.name, url: `assets/models/${k.name}.glb`, bytes: glb.length, sha256: sha(glb), tris, dims, ...surfaces, what: k.what,
    measured: detail, transform: {frame: 'Meshy native (front +Z), +Y up', uniformScale: +s.toFixed(6), sizing: k.size, rawExtent: raw.map(v => +v.toFixed(4)), grounded: 'min y = 0', centred: 'x / z bounding-box centre at 0', simplification: 'none'},
    textures, texturePolicy: {baseColor: tb, metallicRoughness: tmr, normal: tn, encoding: 'JPEG (base / metallicRoughness q86, normal q90)'},
    generation: record, glb});
}

console.log(JSON.stringify(out.map(({glb, generation, ...k}) => k), null, 1));
if (DRY) process.exit(0);

const written = [];
for (const k of out) { fs.writeFileSync(path.join(PUB, k.url), k.glb); written.push(k.url); }
const prov = {schema: 'last-line-derivative/1', asset: 'corpse-shop-kit-20261114', task: TASK, lane: 'ASSET (cook); the task generated the models under its scoped credit grant',
  status: 'runtime derivatives of NEW Survivor Market corpse-den models generated for this project with Meshy T2.5 (smart topology, image-to-3D) through the Meshy MCP from Codex initial reference images; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  rebuild: 'node tools/asset-pipeline/props/build-corpse-shop-kit.mjs',
  rawStorage: 'the task folder outside Git: gen/raw/<ID>-<reservation>-<Meshy task>.glb (+ _textures/), gen/out/<ID>-a1.png (Codex), finance/ledger.jsonl, gen/codex/codex.jsonl',
  texturePolicy: 'Meshy maps kept channel for channel (the master\'s own base colour / packed metallic-roughness / normal; resized / re-encoded JPEG only); no reprojection / retexture / repaint',
  levelOnly: 'market (game/src/assets/levelAssets.ts LEVEL_ONLY_RULES market-*)',
  models: out.map(({glb, key, modelKey, ...k}) => ({key: modelKey, ...k}))};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
assertPublicSafe(provBuf.toString(), KIT_PROV_REL);
fs.writeFileSync(path.join(PUB, KIT_PROV_REL), provBuf); written.push(KIT_PROV_REL);
const m = Object.fromEntries(out.map(k => [k.key, k]));
const reg = `// GENERATED by tools/asset-pipeline/props/build-corpse-shop-kit.mjs — do not edit (task ${TASK}).
// The Survivor Market corpse buyer's den: its own Meshy T2.5 props (from Codex initial reference images); provenance ${KIT_PROV_REL}.
// Models: real size (metres), +Y up, front +Z, grounded (min y 0), centred on x / z; maps kept from Meshy. Surfaces measured on the
// cooked geometry: the chute's rimY = the hopper rim's top (its lid stands open along the back edge, up to dims[1]), throat = its open
// mouth at the floor [x0, x1, z0, z1] (model frame; no shaft is modelled); the booth's counterY = its counter top, counterZ = the
// counter's front edge (+z from the model centre).
export interface CorpseShopKitModel {
  key: string; url: string; bytes: number; tris: number; dims: readonly [number, number, number];
  /** Measured surfaces (m above the floor): the chute's hopper rim, the booth's counter top / its front edge's +z reach. */
  rimY?: number; counterY?: number; counterZ?: number;
  /** The chute's open throat at the floor, seen straight down (model frame, m): [x0, x1, z0, z1]. */
  throat?: readonly [number, number, number, number];
}
export const CORPSE_SHOP_KIT = {
  chute: {key: '${m.chute.modelKey}', url: '${m.chute.url}', bytes: ${m.chute.bytes}, tris: ${m.chute.tris}, dims: [${m.chute.dims.join(', ')}], rimY: ${m.chute.rimY}, throat: [${[...m.chute.measured.throatX, ...m.chute.measured.throatZ].join(', ')}]},
  booth: {key: '${m.booth.modelKey}', url: '${m.booth.url}', bytes: ${m.booth.bytes}, tris: ${m.booth.tris}, dims: [${m.booth.dims.join(', ')}], counterY: ${m.booth.counterY}, counterZ: ${m.booth.counterZ}},
} as const satisfies Readonly<Record<string, CorpseShopKitModel>>;
`;
fs.writeFileSync(REG, reg);
writeCredits();
updateAllowlist(written);
console.log('wrote', written.join(', '), '+', path.relative(ROOT, REG), '+ CREDITS.md section + public-inputs.json rows');
