// Task studio-beta-mall-lingerie-store-polish-20261103-045922-01 (lane FIT): the lingerie boutique's stock on the SHIPPED files (CI-safe:
// no private raw sources needed). User: "we literally have a female mannequin model that the cloths could be put on!" / "racks of
// clothing ... (but ofc liginiery on the racks)".
//  - the six sets FITTED to the Mall's female display mannequin (mall-mannequin-female.glb, M81): LingerieMannequin_<design>_top /
//    _bottom in each outfit-lingerie-<design>.glb, unskinned, identity node, the mannequin model's own frame; measured against the
//    mannequin mesh itself: no cloth inside the figure, no figure poking through, bust / groin covered, no floating;
//  - hanging rack items LingerieHang_<design>_<item>: garment primitive(s) + an untextured chrome hanger primitive, origin = the hook
//    resting on the rail; physically supported (the garment touches its hanger), hanging below the rail, within the rail limits;
//  - the worn zombie variants stay byte-identical to their c1a3816 build (accessor + extras digests pinned).
import {describe, expect, it, beforeAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NodeIO, type Document, type Node} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {LINGERIE_SETS, LINGERIE_MANNEQUIN_SETS, LINGERIE_HANG_SETS, LINGERIE_MANNEQUIN_MODEL} from '../src/ai/lingerie';
import {MALL_KIND_ASSET} from '../src/gen/mall/kinds';
import {MALL_ASSETS} from '../src/assets/mallAssets';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUB = path.join(ROOT, 'game/public');
const lib = async (f: string) => import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/zombie/lib', f)).href);
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
const docs: Record<string, Document> = {};
beforeAll(async () => { for (const s of LINGERIE_SETS) docs[s.design] = await io().read(path.join(PUB, s.url)); }, 60_000);
const node = (d: string, name: string): Node | undefined => docs[d].getRoot().listNodes().find(n => n.getName() === name);
const arr = (n: Node, k = 0, sem = 'POSITION') => { const a = n.getMesh()!.listPrimitives()[k].getAttribute(sem)!; return Float32Array.from(a.getArray()!, v => (a.getNormalized() ? v / 127 : v)); };

/** Digests of the worn variants (POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0, indices, extras) of the c1a3816 / main dbfef67 build. */
const WORN = {
  'Outfit_lingerie-green-top__paleApparition': '7113c9f100b8d265a10ebae5', 'Outfit_lingerie-green-bottom__paleApparition': '91c3cbe7dc7d0279d293a607',
  'Outfit_lingerie-purple-top__paleGaze': 'd570108eb30e359f5aa81b71', 'Outfit_lingerie-purple-bottom__paleGaze': '563b78fcc1aa658ee4bd0728',
  'Outfit_lingerie-blush-top__paleApparition': '6070545900f5a3f96ee70cb0', 'Outfit_lingerie-blush-bottom__paleApparition': 'd5a68f71b8fde120551b099a',
  'Outfit_lingerie-black-top__paleRevenant': '8888cb63df6fe312d8dcfda4', 'Outfit_lingerie-black-bottom__paleRevenant': 'b30b0725cc16291b9b23938e',
  'Outfit_lingerie-red-top__paleGaze': '35af9bfd11c2813b253f07d9', 'Outfit_lingerie-red-bottom__paleGaze': 'e9068b7806c1e19500177038',
  'Outfit_lingerie-ivory-top__paleRevenant': '69f1381016bda8ec418cbb3c', 'Outfit_lingerie-ivory-bottom__paleRevenant': '7db9d3bcf8603e8fe06fb56b',
} as Record<string, string>;

describe('lingerie on the female display mannequin', () => {
  it('targets the Mall female mannequin model (M81) and lists both mannequin nodes of every set', () => {
    expect(LINGERIE_MANNEQUIN_MODEL).toBe(MALL_KIND_ASSET.mannequinFemale);
    expect(MALL_ASSETS[LINGERIE_MANNEQUIN_MODEL]?.url).toBe('assets/models/mall-mannequin-female.glb');
    expect(LINGERIE_MANNEQUIN_SETS.map(s => s.design).sort()).toEqual(LINGERIE_SETS.map(s => s.design).sort());
    for (const s of LINGERIE_MANNEQUIN_SETS) for (const n of [s.nodes.top, s.nodes.bottom]) {
      const nd = node(s.design, n);
      expect(nd, n).toBeTruthy();
      expect(nd!.getSkin()).toBeNull();
      expect(nd!.getTranslation()).toEqual([0, 0, 0]);
      expect(nd!.getRotation()).toEqual([0, 0, 0, 1]);
      expect(nd!.getScale()).toEqual([1, 1, 1]);
      const p = nd!.getMesh()!.listPrimitives();
      expect(p.length).toBe(1);
      expect(p[0].getMaterial()!.getBaseColorTexture()).toBeTruthy(); // the set's own lace material (shared with the worn variants)
    }
  });

  it('fits the actual mannequin mesh: no cloth inside the figure, nothing poking through, bust / groin covered, no floating', async () => {
    const {loadMannequin, measureMannequin, toModelFrame} = await lib('lingerie-mannequin.mjs');
    const M = await loadMannequin(path.join(PUB, 'assets/models/mall-mannequin-female.glb'));
    const report: string[] = [];
    for (const s of LINGERIE_MANNEQUIN_SETS) {
      const pieces: Record<string, {pos: Float32Array; idx: Uint32Array}> = {};
      for (const [pn, n] of Object.entries(s.nodes)) { const nd = node(s.design, n)!; pieces[pn] = {pos: toModelFrame(arr(nd)), idx: Uint32Array.from(nd.getMesh()!.listPrimitives()[0].getIndices()!.getArray()!)}; }
      const S = measureMannequin(M, pieces);
      for (const [pn, P] of Object.entries(S.pieces as Record<string, {penetration: number; deep: number; minSdMM: number; hover: number; edgeHover: number}>)) {
        if (P.penetration > 0.005) report.push(`${s.design} ${pn}: penetration ${P.penetration}`);
        if (P.deep > 0) report.push(`${s.design} ${pn}: deep ${P.deep}`);
        if (P.minSdMM < -3) report.push(`${s.design} ${pn}: min sd ${P.minSdMM} mm`);
        if (P.hover > 0.06) report.push(`${s.design} ${pn}: hover ${P.hover}`);
        if (P.edgeHover > 0.12) report.push(`${s.design} ${pn}: free-edge hover ${P.edgeHover}`);
      }
      if (S.body.pokeVisible > 3) report.push(`${s.design}: ${S.body.pokeVisible} mannequin vertices poke through`);
      if (S.coverage.apex < 1 || S.coverage.groinCore < 1) report.push(`${s.design}: coverage ${JSON.stringify(S.coverage)}`);
    }
    expect(report).toEqual([]);
  }, 120_000);
});

describe('lingerie rack stock (hanging items)', () => {
  it('hangs every item on its hanger below the rail contact, supported, within the rail limits', async () => {
    const {closestOnTri} = await lib('penetration.mjs');
    const report: string[] = [];
    for (const s of LINGERIE_HANG_SETS) {
      expect(s.items.length, s.design).toBeGreaterThanOrEqual(1);
      for (const it of s.items) {
        const nd = node(s.design, it.node);
        expect(nd, it.node).toBeTruthy();
        expect(nd!.getSkin()).toBeNull();
        const prims = nd!.getMesh()!.listPrimitives();
        const hangerPrim = prims.findIndex(p => p.getMaterial()!.getName() === 'LingerieHanger');
        expect(hangerPrim, it.node).toBe(prims.length - 1);
        expect(prims[hangerPrim].getMaterial()!.getBaseColorTexture()).toBeNull(); // plain hardware, no art
        const H = arr(nd!, hangerPrim), HI = Uint32Array.from(prims[hangerPrim].getIndices()!.getArray()!);
        let hTop = -Infinity; for (let i = 1; i < H.length; i += 3) hTop = Math.max(hTop, H[i]);
        expect(hTop, `${it.node} hook top`).toBeGreaterThan(0); // the wire's top sits on the rail (contact = origin)
        expect(hTop).toBeLessThan(0.008);
        let gTop = -Infinity, gLow = Infinity, xMin = Infinity, xMax = -Infinity, dMin = Infinity;
        for (let k = 0; k < hangerPrim; k++) {
          const G = arr(nd!, k);
          for (let i = 0; i < G.length; i += 3) {
            gTop = Math.max(gTop, G[i + 1]); gLow = Math.min(gLow, G[i + 1]); xMin = Math.min(xMin, G[i]); xMax = Math.max(xMax, G[i]);
            // distance to the hanger SURFACE (its triangles), only for garment points near the hanger's height
            if (G[i + 1] > -0.13) for (let t = 0; t < HI.length; t += 3) { const q = closestOnTri([G[i], G[i + 1], G[i + 2]], H, HI[t] * 3, HI[t + 1] * 3, HI[t + 2] * 3); const d = Math.hypot(G[i] - q[0], G[i + 1] - q[1], G[i + 2] - q[2]); if (d < dMin) dMin = d; }
          }
        }
        if (gTop >= 0) report.push(`${it.node}: garment above the rail contact (${gTop})`);
        if (dMin > 0.012) report.push(`${it.node}: garment not resting on its hanger (closest ${dMin.toFixed(4)} m)`);
        if (-gLow > 0.65 || -gLow < 0.15) report.push(`${it.node}: drop ${-gLow}`); // the one-piece bodysuit hangs ~0.6 m
        if (Math.max(xMax, 0.156) - Math.min(xMin, -0.156) > 0.45) report.push(`${it.node}: wider than 0.45 m`);
        expect(it.dropM).toBeCloseTo(-gLow, 3);
        const ex = nd!.getExtras() as {lingerieHang?: {hanger: string}};
        expect(ex.lingerieHang?.hanger).toBe(it.hanger);
      }
    }
    expect(report).toEqual([]);
  });
});

describe('worn variants unchanged', () => {
  it('keeps every worn zombie mesh byte-identical (accessors + extras) to the shipped c1a3816 build', () => {
    const got: Record<string, string> = {};
    for (const s of LINGERIE_SETS) for (const n of docs[s.design].getRoot().listNodes()) {
      if (!n.getName().startsWith('Outfit_')) continue;
      const p = n.getMesh()!.listPrimitives()[0], h = createHash('sha256');
      for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) { const a = p.getAttribute(sem)!.getArray()!; h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); }
      const ix = p.getIndices()!.getArray()!; h.update(Buffer.from(ix.buffer, ix.byteOffset, ix.byteLength));
      h.update(JSON.stringify(n.getExtras()));
      got[n.getName()] = h.digest('hex').slice(0, 24);
    }
    expect(got).toEqual(WORN);
  });

  it('records the mannequin fit in each set\'s provenance', () => {
    for (const s of LINGERIE_SETS) {
      const j = JSON.parse(readFileSync(path.join(PUB, `assets/derivatives/outfit-lingerie-${s.design}.json`), 'utf8'));
      expect(j.mannequin.model).toBe('mannequin-female');
      expect(j.mannequin.limitsFailed).toEqual([]);
      expect(j.hang.items.length).toBe(s.hang.length);
    }
  });
});
