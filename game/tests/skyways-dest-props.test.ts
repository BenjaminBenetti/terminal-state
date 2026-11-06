// Task studio-skyways-destinations-20261106-170011-01 (lane KITS): the runtime derivatives of the Skyways DESTINATION kit (Codex initial
// concept -> Meshy T2.5 image-to-3D; Meshy's own PBR maps kept, re-encoded / downsized only), cooked by
// tools/asset-pipeline/props/build-skyways-dest-props.mjs. Every BUILT row of SKYWAYS_DEST_PROPS: the real-size fit on the piece's axis,
// grounded / centred / baked pivot, the triangle budget, plain glTF with one opaque material carrying all three Meshy maps at the tier's
// sizes, the registry = the measured bounds, the measured extras (shelves, tiers, seat, bins, hanging point) where the mesh is,
// provenance <-> bytes (Meshy task id, ledger lines, input / raw sha256; no URLs or signatures) and the release allowlist. Rows still
// `planned: true` are skipped (no file, no allowlist entry).
import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {SKYWAYS_DEST_PROPS, type SkywaysDestProp} from '../src/assets/skywaysDestProps.generated';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type Tier = 'hero' | 'fixture' | 'small';
/** The brief's 46 pieces (gen/assets.json): id, real size axis (h height / w width x / l long axis -> x / d depth z) + metres, budget, tier. */
const SPEC: [string, 'h' | 'w' | 'l' | 'd', number, number, Tier][] = [
  ['lm-clock', 'h', 5.6, 30000, 'hero'], ['lm-dino', 'l', 7.5, 30000, 'hero'], ['lm-tree', 'h', 7.0, 30000, 'hero'], ['lm-fountain', 'w', 5.2, 30000, 'hero'],
  ['lm-geese', 'w', 7.0, 30000, 'hero'], ['lm-orrery', 'h', 3.0, 25000, 'hero'],
  ['bk-bookcase', 'h', 2.4, 8000, 'fixture'], ['bk-table', 'w', 1.5, 6000, 'fixture'], ['bk-armchair', 'h', 1.1, 8000, 'fixture'], ['bk-stack', 'w', 0.32, 3000, 'small'],
  ['of-canoe', 'l', 5.0, 10000, 'fixture'], ['of-tent', 'w', 2.1, 8000, 'fixture'], ['of-backpack', 'h', 0.8, 5000, 'small'], ['of-lantern', 'h', 0.36, 3000, 'small'],
  ['of-campchair', 'h', 0.9, 5000, 'fixture'],
  ['mu-bins', 'w', 1.8, 6000, 'fixture'], ['mu-crate', 'w', 0.36, 3000, 'small'], ['mu-guitar', 'h', 1.05, 6000, 'small'], ['mu-piano', 'w', 1.5, 10000, 'fixture'],
  ['mu-drums', 'w', 1.8, 12000, 'fixture'], ['mu-amp', 'h', 1.3, 5000, 'fixture'],
  ['hb-diorama', 'w', 3.0, 25000, 'fixture'], ['hb-vitrine', 'h', 1.9, 8000, 'fixture'], ['hb-kits', 'w', 0.45, 3000, 'small'], ['hb-robot', 'h', 1.0, 10000, 'small'],
  ['ds-sofa', 'w', 2.1, 8000, 'fixture'], ['ds-eggchair', 'h', 1.1, 8000, 'fixture'], ['ds-lamp', 'h', 2.1, 5000, 'fixture'], ['ds-table', 'w', 2.2, 6000, 'fixture'],
  ['ds-bed', 'l', 2.2, 10000, 'fixture'],
  ['gd-bench', 'w', 2.0, 6000, 'fixture'], ['gd-palm', 'h', 2.2, 10000, 'fixture'], ['gd-pot', 'h', 0.35, 4000, 'small'], ['gd-barrow', 'l', 1.5, 6000, 'fixture'],
  ['ar-pinball', 'h', 1.9, 15000, 'fixture'], ['ar-airhockey', 'l', 2.1, 8000, 'fixture'], ['ar-claw', 'h', 1.9, 10000, 'fixture'],
  ['cn-popcorn', 'h', 1.6, 8000, 'fixture'], ['cn-seats', 'w', 2.4, 10000, 'fixture'], ['cn-booth', 'h', 2.4, 8000, 'fixture'],
  ['sc-telescope', 'h', 1.7, 6000, 'fixture'], ['sc-globe', 'h', 1.2, 8000, 'fixture'], ['sc-rocket', 'h', 2.2, 8000, 'fixture'], ['sc-mobile', 'w', 3.0, 10000, 'fixture'],
  ['hk-net', 'w', 1.83, 6000, 'fixture'], ['hk-goalie', 'h', 1.95, 12000, 'fixture'],
];
/** The lead's fit decisions replacing the brief's axis (DECISIONS.md): fountain under a 4.3 m court, display table by height, the
 * vitrine re-scoped to its airship display model (by length), the dining table and the staging bench by their top (topY). */
const FIT: Record<string, ['h' | 'w' | 'l' | 'd' | 'top', number]> = {'lm-fountain': ['w', 4.4], 'bk-table': ['h', 1.1], 'hb-vitrine': ['l', 0.95],
  'ds-table': ['top', 0.75], 'gd-bench': ['top', 0.75]};
/** The lead-approved depth squashes (z, metres): the canoe's beam, the amp's and the pinball cabinet's depth. */
const SQUASH: Record<string, number> = {'of-canoe': 0.95, 'mu-amp': 0.4, 'ar-pinball': 1.45};
/** Map sizes [base colour, metallicRoughness, normal] px by tier (the brief). */
const TEX: Record<Tier, [number, number, number]> = {hero: [2048, 1024, 1024], fixture: [1024, 512, 512], small: [512, 512, 512]};
const AXIS = {h: 1, w: 0, l: 0, d: 2} as const;
const REG = SKYWAYS_DEST_PROPS as Record<string, SkywaysDestProp>;
const keyOf = (id: string) => `skyways_d_${id.replace(/-/g, '_')}`;
const built = SPEC.filter(([id]) => !REG[keyOf(id)].planned);
const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

async function load(url: string) {
  const bytes = readFileSync(pub(url));
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  return {bytes, root, prim, P: prim.getAttribute('POSITION')!.getArray()!, N: prim.getAttribute('NORMAL')!.getArray()!, I: prim.getIndices()!.getArray()!};
}

/** Every crossing of the vertical line (x, z) with the mesh: height + interpolated normal y. */
function column(P: ArrayLike<number>, N: ArrayLike<number>, I: ArrayLike<number>, x: number, z: number) {
  const out: {y: number; ny: number}[] = [];
  for (let f = 0; f < I.length; f += 3) {
    const [a, b, c] = [3 * I[f], 3 * I[f + 1], 3 * I[f + 2]];
    const area = (P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2]);
    if (Math.abs(area) < 1e-14) continue;
    const w0 = ((P[b] - x) * (P[c + 2] - z) - (P[c] - x) * (P[b + 2] - z)) / area, w1 = ((P[c] - x) * (P[a + 2] - z) - (P[a] - x) * (P[c + 2] - z)) / area;
    if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
    const w2 = 1 - w0 - w1;
    out.push({y: w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1], ny: w0 * N[a + 1] + w1 * N[b + 1] + w2 * N[c + 1]});
  }
  return out.sort((p, q) => p.y - q.y);
}
/**
 * The top-most crossing height of the vertical line (x, z) (-Infinity when none). Facing is ignored: Meshy's materials are double-sided
 * and some thin surfaces are a single sheet (the display table's top tier is only its down-facing underside, seen from above as its back face).
 */
const topAt = (P: ArrayLike<number>, N: ArrayLike<number>, I: ArrayLike<number>, x: number, z: number) =>
  Math.max(-Infinity, ...column(P, N, I, x, z).map(h => h.y));

describe('Skyways destination kit (lane KITS)', () => {
  it('the registry has exactly the 46 brief pieces; planned rows have no file and no allowlist entry', () => {
    expect(Object.keys(REG).sort()).toEqual(SPEC.map(([id]) => keyOf(id)).sort());
    for (const [id] of SPEC) {
      const reg = REG[keyOf(id)];
      expect(reg.url).toBe(`assets/models/skyways-d-${id}.glb`);
      if (!reg.planned) continue;
      expect(existsSync(pub(reg.url)), `${id}: planned but a file exists`).toBe(false);
      expect(allow.has(reg.url)).toBe(false);
      expect(allow.has(`assets/derivatives/skyways-d-${id}-model.json`)).toBe(false);
    }
    expect(built.length).toBeGreaterThan(0);
  });

  for (const [id, axis, m, budget, tier] of built) {
    it(`${id}: real size, grounded / centred, budget, Meshy maps kept, registry, provenance and allowlist`, async () => {
      const key = keyOf(id), reg = REG[key], url = reg.url, provRel = `assets/derivatives/skyways-d-${id}-model.json`;
      const {bytes, root, prim} = await load(url);
      const provBytes = readFileSync(pub(provRel));
      const prov = JSON.parse(provBytes.toString());
      // plain glTF: one identity node / mesh / triangle primitive / opaque material; no Draco / meshopt / KTX2
      expect(root.listExtensionsUsed()).toEqual([]);
      expect(root.listNodes()).toHaveLength(1);
      expect(root.listNodes()[0].getMatrix()).toEqual(IDENTITY);
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
      expect(prim.getMode()).toBe(4);
      expect(prim.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
      // bounds: grounded, centred, the size axis at its real size; `l` pieces are long along x
      const b = getBounds(root.getDefaultScene()!);
      const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
      expect(Math.abs(b.min[1])).toBeLessThan(1e-4);
      expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3);
      expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(1e-3);
      const [fitAxis, fitM] = FIT[id] ?? [axis, m];
      if (fitAxis === 'top') expect(Math.abs(reg.topY! - fitM)).toBeLessThanOrEqual(0.01);
      else expect(dims[AXIS[fitAxis]]).toBeCloseTo(fitM, 3);
      if (FIT[id]) expect(prov.fit).toMatchObject({axis: fitAxis, size: fitM, override: {briefAxis: axis, briefSize: m}});
      if (fitAxis === 'l') expect(dims[0]).toBeGreaterThan(dims[2]);
      if (SQUASH[id]) { expect(dims[2]).toBeCloseTo(SQUASH[id], 3); expect(prov.fit.squash).toMatchObject({axis: 'z', to: SQUASH[id]}); } else expect(prov.fit.squash).toBeUndefined();
      // triangle budget (the source mesh is kept only when the raw was already within it, or the seams stalled the collapse — recorded);
      // a lead-approved local mesh separation removes whole parts first
      const tris = prim.getIndices()!.getCount() / 3;
      const removed = prov.separation?.removedTriangles ?? 0;
      if (prov.simplify.applied) expect(tris).toBeLessThanOrEqual(budget);
      else expect(tris).toBe(prov.source.triangles - prov.weld.degenerateTrianglesDropped - removed);
      if (prov.separation) expect(prov.separation.keptTriangles).toBe(prov.source.triangles - prov.weld.degenerateTrianglesDropped - removed);
      if (tris > budget) expect(prov.simplify.reason).toMatch(/stall|crumpled/);
      // the material: Meshy's base colour / metallic-roughness / normal maps kept (JPEG at the tier's sizes), opaque
      const mats = root.listMaterials();
      expect(mats).toHaveLength(1);
      const mat = mats[0];
      expect(mat.getAlphaMode()).toBe('OPAQUE');
      expect(mat.getOcclusionTexture()).toBeNull();
      expect(mat.getEmissiveTexture()).toBeNull();
      [mat.getBaseColorTexture(), mat.getMetallicRoughnessTexture(), mat.getNormalTexture()].forEach((t, i) => {
        expect(t).not.toBeNull();
        expect(t!.getMimeType()).toBe('image/jpeg');
        expect(t!.getSize()).toEqual([TEX[tier][i], TEX[tier][i]]);
      });
      expect(root.listTextures()).toHaveLength(3);
      expect(prov.source.maps.map((q: {slot: string}) => q.slot)).toEqual(['baseColor', 'metallicRoughness', 'normal']);
      expect(prov.texturePolicy).toMatch(/Meshy's own maps kept/);
      // registry = measured runtime bounds
      expect(Math.abs(reg.w - dims[0])).toBeLessThan(1e-3);
      expect(Math.abs(reg.h - dims[1])).toBeLessThan(1e-3);
      expect(Math.abs(reg.d - dims[2])).toBeLessThan(1e-3);
      expect(reg.tris).toBe(tris);
      // provenance binds these bytes: Meshy T2.5 task, the ledger lines, Codex concept + raw sha256; no URLs / signatures / tokens / local paths
      expect(prov).toMatchObject({id: `skyways-d-${id}`, key, piece: {id, tier, size: {axis, m}, budget}, output: {url, bytes: bytes.length, sha256: sha(bytes), triangles: tris}});
      expect(prov.accepted).toBe(true);
      expect(prov.meshy.ledger.lines.accept).toBeGreaterThan(prov.meshy.ledger.lines.raw);
      expect(prov.meshy.task).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(prov.meshy).toMatchObject({status: 'SUCCEEDED', consumedCredits: 15, request: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', enable_pbr: true, texture_resolution: '2k'}});
      expect(prov.meshy.ledger.lines.raw).toBeGreaterThan(prov.meshy.ledger.lines.status);
      expect(prov.source.file).toContain(prov.meshy.task);
      expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.conditioningImage.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.route).toMatch(/^Codex native image_gen INITIAL .* -> Meshy T2\.5 image-to-3D/);
      expect(prov.convention).toMatch(/^metres at real size, \+Y up; .*front|^metres at real size, \+Y up; turned/);
      expect(prov.licence).toMatch(/no blanket licence or commercial clearance implied/);
      expect(provBytes.toString()).not.toMatch(/https?:|Signature|X-Amz|Key-Pair|token=|\/workspaces\/|\/home\/|~\//i);
      expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/https?:\/\/|X-Amz|Signature=/);
      // release allowlist
      expect(allow.get(url)).toEqual({path: url, bytes: bytes.length, sha256: sha(bytes)});
      expect(allow.get(provRel)).toEqual({path: provRel, bytes: provBytes.length, sha256: sha(provBytes)});
    });
  }

  it('the dino lies long along x with its head at -x (skull end higher than the tail tip)', async () => {
    const reg = REG.skyways_d_lm_dino;
    if (reg.planned) return;
    const {P} = await load(reg.url);
    // the skull is at the high end of the neck; the tail tapers low: compare the highest point in each end tenth of the length
    let headTop = -Infinity, tailTop = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < -0.4 * reg.w) headTop = Math.max(headTop, P[i + 1]);
      if (P[i] > 0.4 * reg.w) tailTop = Math.max(tailTop, P[i + 1]);
    }
    expect(reg.w).toBeGreaterThan(2.5 * reg.d);
    expect(headTop).toBeGreaterThan(tailTop + 0.3);
  });

  it('measured extras sit where the mesh is: bookcase shelves, display-table tiers, seats, record bins, hanging point', async () => {
    const R = REG;
    const bc = R.skyways_d_bk_bookcase;
    if (!bc.planned) {
      // shelves: ascending, inside the case, a usable bay (>= 0.25 m) between; an up-facing board top at each height across the bays
      const {P, N, I} = await load(bc.url);
      const ys = bc.shelfY!;
      expect(ys.length).toBeGreaterThanOrEqual(4);
      ys.forEach((y, i) => { expect(y).toBeGreaterThan(0.05); expect(y).toBeLessThan(bc.h - 0.2); if (i) expect(y - ys[i - 1]).toBeGreaterThan(0.25); });
      for (const y of ys) for (const x of [-0.4, 0, 0.4].map(f => f * bc.w)) {
        const hits = column(P, N, I, x, 0);
        expect(hits.some(h => h.ny > 0.3 && Math.abs(h.y - y) < 0.02), `bookcase shelf ${y} at x ${x.toFixed(2)}`).toBe(true);
      }
    }
    const tb = R.skyways_d_bk_table;
    if (!tb.planned) {
      // tiers: ascending heights, shrinking radii; the top-most surface at mid-ring of each exposed tier ring is that tier
      const {P, N, I} = await load(tb.url);
      const [ys, ro, ri] = [tb.tierY!, tb.tierR!, tb.tierRIn!];
      expect(ys.length).toBe(3);
      expect(tb.topY).toBe(ys[ys.length - 1]);
      ys.forEach((y, i) => {
        expect(ri[i]).toBeLessThan(ro[i]);
        if (i) { expect(y).toBeGreaterThan(ys[i - 1] + 0.3); expect(ro[i]).toBeLessThan(ro[i - 1]); }
        const r = (ro[i] + ri[i]) / 2;
        for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) expect(Math.abs(topAt(P, N, I, x, z) - y), `tier ${i} at (${x}, ${z})`).toBeLessThan(0.02);
      });
    }
    // seats: the seat top in the seat middle (front half), at a sitting height
    for (const k of ['skyways_d_bk_armchair', 'skyways_d_of_campchair', 'skyways_d_ds_sofa', 'skyways_d_ds_eggchair']) {
      const s = R[k];
      if (s.planned) continue;
      expect(s.seatY, k).toBeGreaterThan(0.33);
      expect(s.seatY!).toBeLessThan(0.56);
      const {P, N, I} = await load(s.url);
      expect(Math.abs(topAt(P, N, I, 0, 0.15 * s.d) - s.seatY!), k).toBeLessThan(0.04);
    }
    const bins = R.skyways_d_mu_bins;
    if (!bins.planned) {
      // the record bins slope up from the front lip (topY) to the back rim (backY)
      const {P, N, I} = await load(bins.url);
      expect(bins.backY!).toBeGreaterThan(bins.topY! + 0.3);
      expect(Math.abs(topAt(P, N, I, 0, 0.45 * bins.d) - bins.topY!)).toBeLessThan(0.03);
      expect(topAt(P, N, I, 0, 0)).toBeGreaterThan(bins.topY!);
      expect(topAt(P, N, I, 0, 0)).toBeLessThan(bins.backY!);
    }
    for (const k of ['skyways_d_lm_geese', 'skyways_d_of_canoe', 'skyways_d_sc_mobile']) if (!R[k].planned) expect(R[k].hangY, k).toBe(R[k].h);
    const dio = R.skyways_d_hb_diorama;
    if (!dio.planned) {
      // the table top under the scenery: an up-facing crossing at topY under most of the layout, with the scenery above it
      const {P, N, I} = await load(dio.url);
      let at = 0, n = 0;
      for (const fx of [-0.3, 0, 0.3]) for (const fz of [-0.3, 0, 0.3]) {
        n++;
        const hits = column(P, N, I, fx * dio.w, fz * dio.d);
        if (hits.some(h => h.ny > 0.3 && Math.abs(h.y - dio.topY!) < 0.01)) at++;
      }
      expect(at).toBe(n);
      expect(dio.topY!).toBeGreaterThan(0.75);
      expect(dio.topY!).toBeLessThan(dio.h - 0.3);
    }
    // flat tops (tables / benches / the air-hockey rink / the bed): the top-most crossing at the centre sits at topY
    for (const k of ['skyways_d_ds_table', 'skyways_d_gd_bench', 'skyways_d_ar_airhockey', 'skyways_d_ds_bed']) {
      const t = R[k];
      if (t.planned) continue;
      const {P, N, I} = await load(t.url);
      expect(Math.abs(topAt(P, N, I, 0.1 * t.w, 0.05 * t.d) - t.topY!), k).toBeLessThan(0.03);
    }
  });
});
