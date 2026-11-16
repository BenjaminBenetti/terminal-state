// Task studio-survivor-market-crevice-20261116-074419-01 (lane BRIDGE): the Survivor Market crevice layout's modular walkway-bridge kit
// (assets/marketBridgeKit.generated.ts; tools/asset-pipeline/props/build-market-bridge-kit.mjs), cut from the user's own bridge model:
//  - the GLB and its provenance on disk at the recorded bytes, allowlisted (tools/release/public-inputs.json path / bytes / sha256),
//    credited, the provenance hash-only (no URL / token / local path / master file name);
//  - Market-only (assets/levelAssets.ts 'market-*'), never a boot model;
//  - the four piece nodes match the catalog: identity transforms, bounds and triangle counts, the deck's walking surface at y 0, the
//    handrails on z = +-1 at railH, the Mid / MidPlain joint planes at x 0 / length with matching cross-sections (so copies tile and
//    the End meets a bay), the Trestle's top at y 0;
//  - one material with the model's own base colour / metallic-roughness / normal maps and no emissive.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO, type Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MARKET_BRIDGE_KIT} from '../src/assets/marketBridgeKit.generated';
import {assetAllowedIn, levelOfAsset, selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(GAME, 'public');
const REPO = path.resolve(GAME, '..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const PROV = 'assets/derivatives/market-bridge-kit.json';
const MASTER = {sha256: '729afb41d59d3bed61aa6d545f33a84acea878cbb0f9f66ec1f52d0945cf9f0f', bytes: 43177692};
const NODES = ['End', 'Mid', 'MidPlain', 'Trestle'] as const;
type PieceName = (typeof NODES)[number];
const K = MARKET_BRIDGE_KIT;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
const UNSAFE = /https?:|token=|Signature=|X-Amz|Key-Pair-Id|api[_-]?key=|Bearer |\/workspaces\/|\/home\/|reference\/|user-bridge-master/i;

interface Piece { P: Float32Array; I: Uint32Array }
let doc: Document;
const piece = {} as Record<PieceName, Piece>;

beforeAll(async () => {
  doc = await io.read(path.join(PUB, K.url));
  for (const n of doc.getRoot().listNodes()) {
    const prim = n.getMesh()!.listPrimitives()[0];
    piece[n.getName() as PieceName] = {P: prim.getAttribute('POSITION')!.getArray() as Float32Array, I: Uint32Array.from(prim.getIndices()!.getArray()!)};
  }
});

function bounds(m: Piece): {min: number[]; max: number[]} {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.P[i + k]); max[k] = Math.max(max[k], m.P[i + k]); }
  return {min, max};
}

/** Area-weighted median height of the up-facing (normal y > 0.9) triangles whose centroid passes `keep`, and their area (m2). */
function upMedian(m: Piece, keep: (x: number, y: number, z: number) => boolean): {y: number; area: number} {
  const rows: [number, number][] = [];
  const {P, I} = m;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[b] - P[a], ay = P[b + 1] - P[a + 1], az = P[b + 2] - P[a + 2], bx = P[c] - P[a], by = P[c + 1] - P[a + 1], bz = P[c + 2] - P[a + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l < 0.9) continue;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (keep(cx, cy, cz)) rows.push([cy, l / 2]);
  }
  rows.sort((p, q) => p[0] - q[0]);
  const area = rows.reduce((s, r) => s + r[1], 0);
  let acc = 0;
  for (const [y, a] of rows) { acc += a; if (acc >= area / 2) return {y, area}; }
  return {y: NaN, area};
}

/**
 * The piece's cross-section on the plane x = c: the triangles crossing it cut into (y, z) segments. Returns their y / z extents and the
 * 5 cm (y, z) cells the segments pass through (independent of which border vertices the decimation kept).
 */
function sectionAt(m: Piece, c: number): {y: [number, number]; z: [number, number]; cells: Set<string>} {
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const cells = new Set<string>();
  const {P, I} = m;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3], s = v.map(i => P[i] - c);
    if (s.every(q => q > 0) || s.every(q => q < 0)) continue;
    const pts: [number, number][] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], sa = s[e], sb = s[(e + 1) % 3];
      if ((sa < 0) !== (sb < 0)) { const u = sa / (sa - sb); pts.push([P[a + 1] + u * (P[b + 1] - P[a + 1]), P[a + 2] + u * (P[b + 2] - P[a + 2])]); }
    }
    if (pts.length < 2) continue;
    const [p, q] = pts, n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.01) + 1;
    for (let k = 0; k <= n; k++) {
      const y = p[0] + ((q[0] - p[0]) * k) / n, z = p[1] + ((q[1] - p[1]) * k) / n;
      y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      cells.add(`${Math.floor(y / 0.05)},${Math.floor(z / 0.05)}`);
    }
  }
  return {y: [y0, y1], z: [z0, z1], cells};
}
/** The share of a's cells with one of b's cells within one cell (a few mm of drift across a cell border is not a mismatch). */
function coverage(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const k of a) {
    const [i, j] = k.split(',').map(Number);
    let hit = false;
    for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) hit = b.has(`${i + di},${j + dj}`);
    if (hit) n++;
  }
  return n / a.size;
}

/** Highest surface straight above / below the point (x, z): a vertical ray against every triangle's xz projection. */
function topAt(m: Piece, x: number, z: number): number {
  const {P, I} = m;
  let top = -Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d;
    const l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    top = Math.max(top, l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
  }
  return top;
}

/** The handrail's top over the line z = side * railZ: the highest hit within +-4 cm of the line every 0.1 m along x; the median sample. */
function railTop(m: Piece, side: 1 | -1, x0: number, x1: number): number {
  const tops: number[] = [];
  for (let x = x0 + 0.05; x < x1 - 0.04; x += 0.1) {
    const top = Math.max(...[-0.04, -0.02, 0, 0.02, 0.04].map(dz => topAt(m, x, side * K.railZ + dz)));
    if (Number.isFinite(top)) tops.push(top);
  }
  tops.sort((a, b) => a - b);
  return tops[tops.length >> 1];
}

describe('market bridge kit: files, scope, credits, provenance', () => {
  it('the GLB and its provenance on disk at the recorded bytes, allowlisted; Market-only, never a boot model', () => {
    const glb = fs.readFileSync(path.join(PUB, K.url));
    expect(glb.length).toBe(K.bytes);
    expect(sha(glb)).toBe(K.sha256);
    expect(allow.files.find(f => f.path === K.url)).toEqual({path: K.url, bytes: glb.length, sha256: sha(glb)});
    const prov = fs.readFileSync(path.join(PUB, PROV));
    expect(allow.files.find(f => f.path === PROV)).toEqual({path: PROV, bytes: prov.length, sha256: sha(prov)});
    expect(K.key).toMatch(/^market-/);
    expect(levelOfAsset(K.url)).toBe('market');
    expect(assetAllowedIn('market', K.url)).toBe(true);
    const files = {[K.key]: {url: K.url, bytes: K.bytes}};
    expect(selectLevelKeys('market', [K.key], files).foreign).toEqual([]);
    for (const lv of ['subway', 'office', 'mall', 'reactor', 'skyways', 'bunker']) {
      expect(assetAllowedIn(lv, K.url), `${K.url} @ ${lv}`).toBe(false);
      expect(selectLevelKeys(lv, [K.key], files).foreign).toEqual([K.key]);
    }
    expect(Object.values(MODEL_FILES).some(f => f.url === K.url)).toBe(false);
  });

  it('credited in its own CREDITS.md section (no clearance implied), CREDITS.md allowlisted', () => {
    const credits = fs.readFileSync(path.join(PUB, 'assets/CREDITS.md'));
    expect(allow.files.find(f => f.path === 'assets/CREDITS.md')).toEqual({path: 'assets/CREDITS.md', bytes: credits.length, sha256: sha(credits)});
    const text = credits.toString('utf8');
    const a = text.indexOf('<!-- BEGIN market-bridge-kit-20261116'), b = text.indexOf('<!-- END market-bridge-kit-20261116 -->');
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    const sec = text.slice(a, b);
    expect(sec).toContain(K.url);
    expect(sec).toContain(PROV);
    expect(sec).toMatch(/NOT verified/);
    expect(sec).toMatch(/no clearance is implied/);
    expect(sec).not.toMatch(UNSAFE);
  });

  it('provenance: hash-only, names the master by sha / bytes, records the GLB and the catalog measures', () => {
    const text = fs.readFileSync(path.join(PUB, PROV), 'utf8');
    expect(text).not.toMatch(UNSAFE);
    const rec = JSON.parse(text);
    expect(rec.schema).toBe('terminal-state-derivative-v1');
    expect(rec.id).toBe(K.key);
    expect(rec.level).toBe('market');
    expect(rec.task).toBe('studio-survivor-market-crevice-20261116-074419-01');
    expect(rec.source).toMatchObject(MASTER);
    expect(rec.output).toMatchObject({url: K.url, bytes: K.bytes, sha256: K.sha256, deckY: K.deckY, railZ: K.railZ, railH: K.railH, girderDepth: K.girderDepth,
      legCutDepth: K.legCutDepth, cableDrop: K.cableDrop, midLength: K.pieces.Mid.length, endLength: K.pieces.End.length, endTrestleX: K.endTrestleX, stretch: K.stretch});
    for (const n of NODES) expect(rec.output.pieces[n]).toMatchObject({node: n, tris: K.pieces[n].tris, min: K.pieces[n].min, max: K.pieces[n].max});
    // the model's own maps, kept slot for slot (re-encoded), each recorded by hash
    expect(rec.textures.map((t: {slot: string}) => t.slot).sort()).toEqual(['baseColor', 'metallicRoughness', 'normal']);
    for (const t of rec.textures) expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('market bridge kit: the pieces match the catalog', () => {
  it('four named mesh nodes with identity transforms; bounds and triangle counts as recorded', () => {
    const nodes = doc.getRoot().listNodes();
    expect(nodes.map(n => n.getName()).sort()).toEqual([...NODES].sort());
    for (const n of nodes) {
      expect(n.getTranslation()).toEqual([0, 0, 0]);
      expect(n.getRotation()).toEqual([0, 0, 0, 1]);
      expect(n.getScale()).toEqual([1, 1, 1]);
      expect(n.getMesh()!.listPrimitives().length).toBe(1);
    }
    for (const n of NODES) {
      const b = bounds(piece[n]);
      for (let k = 0; k < 3; k++) {
        expect(b.min[k], `${n} min ${k}`).toBeCloseTo(K.pieces[n].min[k], 3);
        expect(b.max[k], `${n} max ${k}`).toBeCloseTo(K.pieces[n].max[k], 3);
      }
      expect(piece[n].I.length / 3, n).toBe(K.pieces[n].tris);
    }
    // the lighter cook's budgets (the crevice shows five bridges at once)
    expect(K.pieces.End.tris).toBeLessThanOrEqual(8000);
    expect(K.pieces.MidPlain.tris).toBeLessThanOrEqual(3500);
    expect(K.pieces.Mid.tris).toBeLessThanOrEqual(8000);
    expect(K.pieces.Trestle.tris).toBeLessThanOrEqual(6000);
    expect(K.bytes).toBeLessThan(5 * 1024 * 1024);
  });

  it('the deck\'s walking surface at y 0 (+-1 cm) on End / Mid / MidPlain, a broad board area between the rails', () => {
    expect(K.deckY).toBe(0);
    const L = K.pieces.Mid.length;
    const cases: [PieceName, number, number][] = [['End', K.pieces.End.min[0] + 0.2, -0.05], ['Mid', 0.05, L - 0.05], ['MidPlain', 0.05, L - 0.05]];
    for (const [n, x0, x1] of cases) {
      const d = upMedian(piece[n], (x, y, z) => x > x0 && x < x1 && Math.abs(z) < 0.6 && Math.abs(y) < 0.06);
      expect(Math.abs(d.y), `${n} deck y`).toBeLessThanOrEqual(0.01);
      expect(d.area, `${n} deck area`).toBeGreaterThan(0.5 * (x1 - x0) * 1.2);
    }
  });

  it('the handrails on z = +-1, their tops at railH (0.95 .. 1.15 m: a walker\'s hip / waist)', () => {
    expect(K.railZ).toBe(1);
    expect(K.railH).toBeGreaterThanOrEqual(0.95); expect(K.railH).toBeLessThanOrEqual(1.15);
    const L = K.pieces.Mid.length;
    for (const n of ['Mid', 'MidPlain'] as const) for (const side of [1, -1] as const) {
      expect(Math.abs(railTop(piece[n], side, 0, L) - K.railH), `${n} rail ${side}`).toBeLessThan(0.03);
    }
    for (const side of [1, -1] as const) expect(Math.abs(railTop(piece.End, side, -1.0, 0) - K.railH), `End rail ${side}`).toBeLessThan(0.05);
    // both rails straddle z = +-railZ on every deck piece (the tube's centre-line on the line)
    for (const n of ['End', 'Mid', 'MidPlain'] as const) {
      expect(K.pieces[n].min[2]).toBeLessThan(-K.railZ); expect(K.pieces[n].max[2]).toBeGreaterThan(K.railZ);
      expect(K.pieces[n].min[2]).toBeGreaterThan(-K.railZ - 0.2); expect(K.pieces[n].max[2]).toBeLessThan(K.railZ + 0.2);
    }
  });

  it('joint planes: End x <= 0, Mid / MidPlain x 0 .. length; matching cross-sections so bays tile and meet the End', () => {
    const L = K.pieces.Mid.length;
    expect(K.pieces.MidPlain.length).toBe(L);
    expect(K.pieces.End.max[0]).toBeCloseTo(0, 4);
    expect(K.pieces.End.min[0]).toBeCloseTo(-K.pieces.End.length, 4);
    for (const n of ['Mid', 'MidPlain'] as const) { expect(K.pieces[n].min[0]).toBeCloseTo(0, 4); expect(K.pieces[n].max[0]).toBeCloseTo(L, 4); }
    // 3 mm inside each joint plane (the plane itself holds the clip borders)
    const e = 0.003;
    const s = {End0: sectionAt(piece.End, -e), Mid0: sectionAt(piece.Mid, e), MidL: sectionAt(piece.Mid, L - e), Plain0: sectionAt(piece.MidPlain, e), PlainL: sectionAt(piece.MidPlain, L - e)};
    for (const [a, b, tol] of [['Plain0', 'PlainL', 0.03], ['Mid0', 'MidL', 0.03], ['End0', 'Plain0', 0.03]] as const) {
      for (const k of ['y', 'z'] as const) for (const i of [0, 1]) {
        expect(Math.abs(s[a][k][i] - s[b][k][i]), `${a} vs ${b} ${k}[${i}]`).toBeLessThan(tol);
      }
      // above the deck (the heavy post halves, rails, balusters): the two halves of one joint post must line up
      const above = (c: Set<string>) => new Set([...c].filter(k => Number(k.split(',')[0]) >= 2));
      const [A, B] = [above(s[a].cells), above(s[b].cells)];
      expect(A.size).toBeGreaterThan(50);
      expect(coverage(A, B), `${a} within ${b} above the deck`).toBeGreaterThan(0.95);
      expect(coverage(B, A), `${b} within ${a} above the deck`).toBeGreaterThan(0.95);
      // the whole section (the source's own small differences: one end cuts a deck board where the other meets a board gap, and a
      // transverse beam under the deck sits a few mm off one joint plane)
      expect(coverage(s[a].cells, s[b].cells), `${a} within ${b}`).toBeGreaterThan(0.85);
      expect(coverage(s[b].cells, s[a].cells), `${b} within ${a}`).toBeGreaterThan(0.85);
    }
    // the bay without cables ends at the girders' bottom flanges; Mid's festoon hangs below; the End's leg stubs a little lower
    expect(K.girderDepth).toBeCloseTo(-K.pieces.MidPlain.min[1], 4);
    expect(K.cableDrop).toBeCloseTo(-K.pieces.Mid.min[1], 4);
    expect(K.legCutDepth).toBeCloseTo(-K.pieces.End.min[1], 4);
    expect(K.cableDrop).toBeGreaterThan(K.girderDepth + 0.3);
    expect(K.legCutDepth).toBeGreaterThan(K.girderDepth); expect(K.legCutDepth).toBeLessThan(K.girderDepth + 0.05);
    // Mid = MidPlain + its festoon: the same bay above the girder underside
    expect(K.pieces.Mid.tris).toBeGreaterThan(K.pieces.MidPlain.tris);
    expect(K.pieces.Mid.max[1]).toBeCloseTo(K.pieces.MidPlain.max[1], 3);
  });

  it('the Trestle: top at y 0, feet at -height, centred on x, under the End at endTrestleX', () => {
    const t = K.pieces.Trestle;
    expect(t.max[1]).toBeCloseTo(0, 4);
    expect(t.height).toBeCloseTo(-t.min[1], 4);
    expect(t.height).toBeGreaterThan(1.5);
    expect(Math.abs(t.min[0] + t.max[0])).toBeLessThan(0.01);
    expect(K.endTrestleX).toBeLessThan(0); expect(K.endTrestleX).toBeGreaterThan(K.pieces.End.min[0]);
    expect(K.stretch).toEqual({min: 0.85, max: 1.2});
  });
});

describe('market bridge kit: one material, the model\'s own maps, no emissive', () => {
  it('base colour 2048 JPEG, metallic-roughness / normal 1024; emissive dropped', () => {
    const mats = doc.getRoot().listMaterials();
    expect(mats.length).toBe(1);
    const m = mats[0];
    for (const n of doc.getRoot().listNodes()) expect(n.getMesh()!.listPrimitives()[0].getMaterial()).toBe(m);
    expect(m.getBaseColorTexture()?.getMimeType()).toBe('image/jpeg');
    expect(m.getBaseColorTexture()?.getSize()).toEqual([2048, 2048]);
    expect(m.getMetallicRoughnessTexture()?.getSize()).toEqual([1024, 1024]);
    expect(m.getNormalTexture()?.getSize()).toEqual([1024, 1024]);
    expect(m.getEmissiveTexture()).toBeNull();
    expect(m.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(m.getOcclusionTexture()).toBeNull();
    expect(m.getAlphaMode()).toBe('OPAQUE');
    expect(doc.getRoot().listTextures().length).toBe(3);
  });
});
