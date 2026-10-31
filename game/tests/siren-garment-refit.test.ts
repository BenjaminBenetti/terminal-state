// Task siren-clothing-refit-20261031 (lane FIT): the user-authorised garment-only refit of the Siren's dress
// (tools/asset-pipeline/enemy/lib/garment-refit.mjs, garment-skin.mjs, garment-metrics.mjs; builder build-siren.mjs).
//  1. CI-safe: the refit's landmark map / cup warp invariants; the SHIPPED enemy-siren.glb (no uploads needed): the body faces +Z
//     with the wearer's right = -X (measured), the dress covers the wearer's anatomical RIGHT breast and leaves the LEFT exposed in
//     the bind pose and in sampled frames of the actual clips, no dress vertex inside the skin at rest, the strap rests on the
//     right shoulder, garment weights never use the head and never put shin / foot influence on the skirt above the knee region.
//     These guard the orientation / coverage target and gross fit — they are NOT a visual approval (human review decides).
//  2. Local only (it.skipIf, uploads are not in CI): the builder's dress refit + weights from the pinned uploads reproduce the
//     shipped dress bytes exactly (deterministic), and the uploads are unchanged afterwards.
import {describe, expect, it, beforeAll} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const lib = async (f: string) => import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/enemy/lib', f)).href);
const GLB = path.join(ROOT, 'game/public/assets/models/enemy-siren.glb');
const side = JSON.parse(readFileSync(path.join(ROOT, 'game/public/assets/derivatives/enemy-siren.json'), 'utf8'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytesOf = (a: ArrayLike<number> & {buffer: ArrayBufferLike; byteOffset: number; byteLength: number}) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

describe('garment refit: landmark map and cup warp', () => {
  it('maps the empire seam onto the under-bust line, the cup peak onto the breast top, keeps the skirt length, monotonic', async () => {
    const G = await lib('garment-refit.mjs');
    const {REFIT, verticalMap} = G;
    expect(verticalMap(REFIT.seamN)).toBeCloseTo(REFIT.underBustY, 9);
    expect(Math.abs(verticalMap(REFIT.peakN) - REFIT.breastTopY)).toBeLessThan(0.002);
    expect(verticalMap(-0.30) - verticalMap(-0.40)).toBeCloseTo(0.1 * REFIT.trackScale, 6); // skirt keeps Track1's scale
    let prev = -Infinity;
    for (let y = -0.47; y <= 0.48; y += 0.002) { const v = verticalMap(y); expect(v).toBeGreaterThan(prev); prev = v; }
  });
  it('warps only the upper bodice on the front-right (strap side): zero at the seam, at the back and past the centre front', async () => {
    const {REFIT, cupWarp} = await lib('garment-refit.mjs');
    const D = Math.PI / 180;
    expect(cupWarp(REFIT.cupWarp.peak * D, REFIT.seamN)).toBe(0);
    for (const th of [-180, -135, -110, 15, 60, 120]) expect(cupWarp(th * D, REFIT.peakN), `th ${th}`).toBe(0);
    expect(cupWarp(REFIT.cupWarp.peak * D, REFIT.peakN)).toBeCloseTo(REFIT.cupWarp.deg * D, 9);
  });
});

describe('shipped enemy-siren.glb: refitted dress on the unchanged body (no uploads needed)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let F: any, M: any, R: any;
  beforeAll(async () => {
    const G = await lib('siren-glb.mjs');
    M = await lib('garment-metrics.mjs');
    R = await G.loadRigged(GLB);
    F = M.prepareFit(R, {});
  }, 120_000);

  it('measures the body facing +Z with the wearer\'s RIGHT on -X (face, bust and toes agree)', () => {
    expect(F.facing.forward).toEqual([0, 0, 1]);
    expect(F.facing.wearerRight).toEqual([-1, 0, 0]);
    expect(F.breasts.R.apex[0]).toBeLessThan(-0.05);
    expect(F.breasts.L.apex[0]).toBeGreaterThan(0.05);
  });

  it('bind: covers the wearer\'s RIGHT breast, leaves the LEFT exposed, nothing inside the skin, strap on the right shoulder', () => {
    const m = M.measureFrame(F, null, 0);
    expect(m.coverage.wearerRightBreast.fraction).toBeGreaterThan(0.85);
    expect(m.coverage.wearerRightBreast.apexZone.fraction).toBe(1);
    expect(m.coverage.wearerLeftBreast.fraction).toBeLessThan(0.15);
    expect(m.coverage.wearerLeftBreast.apexZone.fraction).toBe(0);
    expect(m.penetrationTotal.gt3mm).toBe(0);
    expect(m.floor.dressMinY).toBeGreaterThan(0.2);
    // the strap's highest point rests over the RIGHT shoulder (x < 0), medial of the shoulder joint, on the trapezius
    const W = (R.meshes as {name: string}[]).find(x => x.name === 'SirenDress');
    const d = (M.measureFrame(F, null, 0, {withVertex: true}) as {D: Float32Array}).D;
    let top = 0; for (let i = 1; i < d.length; i += 3) if (d[i] > d[top * 3 + 1]) top = (i - 1) / 3;
    const shoulderX = F.joints.R_UpperArm[0];
    expect(W).toBeTruthy();
    expect(d[top * 3]).toBeLessThan(-0.05);
    expect(d[top * 3]).toBeGreaterThan(shoulderX);
    expect(d[top * 3 + 1]).toBeGreaterThan(1.38);
  });

  it('keeps the coverage target in the actual clips (sampled frames of all six)', () => {
    for (const [clip, t] of [['Dormant', 2.0], ['Rise', 0.6], ['Run', 0.3], ['Attack', 0.4], ['Hit', 0.1], ['Death', 1.2]] as const) {
      const m = M.measureFrame(F, clip, t);
      expect(m.coverage.wearerRightBreast.apexZone.fraction, `${clip} ${t} right apex`).toBeGreaterThan(0.95);
      expect(m.coverage.wearerRightBreast.fraction, `${clip} ${t} right`).toBeGreaterThan(0.8);
      expect(m.coverage.wearerLeftBreast.apexZone.fraction, `${clip} ${t} left apex`).toBeLessThan(0.05);
    }
  }, 120_000);

  it('garment weights: no head influence, no shin / foot influence above the knee region (hem / fringe only), rows normalised', () => {
    const d = (R.meshes as {name: string; joints: Uint8Array; weights: Uint8Array; pos: Float32Array}[]).find(x => x.name === 'SirenDress')!;
    const names: string[] = R.names;
    const kneeY = F.joints.L_Shin[1];
    for (let i = 0; i < d.joints.length / 4; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const w = d.weights[i * 4 + k]; s += w; if (!w) continue;
        const nm = names[d.joints[i * 4 + k]];
        expect(nm).not.toBe('Head');
        if (/_(Shin|Foot)$/.test(nm)) expect(d.pos[i * 3 + 1], `vertex ${i} ${nm}`).toBeLessThan(kneeY + 0.10); // hem / fringe share ramps in below the knee (smoothed)
      }
      expect(s).toBe(255);
    }
  });

  const staged = path.join(ROOT, '.cache/track1-siren-20261031');
  const UP = {body: ['1f8ac189e97848b984697f9ab4f4a7c7', '6437be9e8ce2d0c254ad9ef12d22ac6f521c640ab7844d36e84825dc232900b4'], dress: ['fbe47869acac46f3a52d808bab79f80a', 'aa3e731f0bfd6f1a80c5c0ee56c019f1c0d1625c347c5978db56988fa55a2a8c']};
  it.skipIf(!existsSync(path.join(staged, UP.dress[0] + '.glb')))('local only: the builder reproduces the shipped refitted dress exactly from the pinned uploads', async () => {
    const B = await lib('siren-build.mjs'), N = await lib('native-glb.mjs');
    const file = (k: 'body' | 'dress') => path.join(staged, UP[k][0] + '.glb');
    const out = await B.buildSiren({body: {file: file('body'), sha256: UP.body[1], uploadId: UP.body[0]}, dress: {file: file('dress'), sha256: UP.dress[1], uploadId: UP.dress[0]},
      heightM: 1.70, hairLumMax: 60, dressFit: {init: {s: 1.30, t: [-0.040, 0.790, -0.012]}}, skin: {smoothIters: 4}, dressSkin: {thighMax: 0.45, skirt: true}, dressMode: 'refit'});
    expect(sha(bytesOf(Float32Array.from(out.dress.refit.pos)))).toBe(side.fit.dress.changedAttributes.POSITION.refit);
    expect(sha(bytesOf(Float32Array.from(out.dress.refit.nrm)))).toBe(side.fit.dress.changedAttributes.NORMAL.refit);
    for (const k of ['body', 'dress'] as const) expect(N.sha256File(file(k))).toBe(UP[k][1]);
  }, 240_000);
});
