// Task studio-train-crafting-v1-20261111-225628-01: the player train's measured ROOF (assets/trainRoof.generated.ts, written by
// tools/asset-pipeline/train/measure-train-roof.mjs; read through craft/trainFixtures.ts roofTopAtPoint / roofTopAt) really covers the
// cooked shell. The sentry's roof turret may only shoot over this outline (craft/sentry.ts own-hull rule), so the outline must never
// be BELOW the real roof — checked here on the shell's own triangles with a sampling independent of the measuring tool — and should
// not be far ABOVE it either (a needlessly high outline widens the dead zone beside the car). Also: the committed file is what the
// tool measures today, and the turret's seat is the middle hatch's top.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {PLAYER_TRAIN_MODELS} from '../src/assets/playerTrain.generated';
import {TRAIN_TURRET_MEASURED} from '../src/assets/trainEquipment.generated';
import {TRAIN_ROOF, TRAIN_ROOF_SKIN_Y, roofTopAt, roofTopAtPoint, turretMount} from '../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as S} from '../src/world/playerTrainSpec';

type V3 = [number, number, number];
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));

/** The shell's triangles that reach above `minY` (train-local metres). */
async function roofTris(minY: number): Promise<[V3, V3, V3][]> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(readFileSync(pub(PLAYER_TRAIN_MODELS['player-train-shell'].url))));
  const out: [V3, V3, V3][] = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
      const at = (i: number): V3 => {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
      };
      for (let i = 0; i + 2 < I.length; i += 3) {
        const t: [V3, V3, V3] = [at(I[i]), at(I[i + 1]), at(I[i + 2])];
        if (Math.max(t[0][1], t[1][1], t[2][1]) > minY) out.push(t);
      }
    }
  }
  return out;
}

describe('the player train roof outline (assets/trainRoof.generated.ts)', () => {
  it('covers every point of the cooked shell roof, and hugs it', async () => {
    const tris = await roofTris(2.9);
    expect(tris.length).toBeGreaterThan(2000);
    let worst = 0, samples = 0, under = 0, at = '';
    // the highest real point per (stretch, 2 cm band) the samples saw: how far above it the outline sits
    const seen = new Map<string, number>();
    for (const [a, b, c] of tris) {
      const longest = Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), Math.hypot(c[0] - a[0], c[2] - a[2]), Math.hypot(c[0] - b[0], c[2] - b[2]));
      const n = Math.max(1, Math.min(40, Math.ceil(longest / 0.004)));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        const x = a[0] * w + b[0] * u + c[0] * v, y = a[1] * w + b[1] * u + c[1] * v, z = a[2] * w + b[2] * u + c[2] * v;
        if (y < 2.9) continue;
        samples++;
        const top = roofTopAtPoint(x, z, S);
        if (y - top > worst) { worst = y - top; at = `(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) over ${top}`; }
        if (roofTopAt(z, S) < top) under++;
        const R = TRAIN_ROOF, k = Math.floor(Math.abs(z) / R.step + 1e-9);
        const hatch = Math.abs(z) <= R.hatchZ ? R.hatches.findIndex(h => x >= h.x0 && x <= h.x1) : -1;
        const key = `${hatch >= 0 ? `h${hatch}` : Math.abs(x) > R.endX ? 'e' : 'b'}:${k}`;
        if (!(seen.get(key)! >= y)) seen.set(key, y);
      }
    }
    expect(samples).toBeGreaterThan(200000);
    expect(worst, `the outline is below the roof at ${at}`).toBeLessThanOrEqual(1e-6);
    expect(under).toBe(0); // the whole-length outline is never below a stretch's own
    // hugging: an outline is "the highest point at or beyond |z|", so compare it with the highest sample at or beyond each band
    const R = TRAIN_ROOF;
    const check = (name: string, T: readonly number[], floor?: readonly number[]) => {
      let beyond = -Infinity;
      for (let k = T.length - 1; k >= 0; k--) {
        beyond = Math.max(beyond, seen.get(`${name}:${k}`) ?? -Infinity, floor ? floor[k] - 0.0031 : -Infinity);
        if ((k + 1) * R.step > S.width / 2 || !Number.isFinite(beyond)) continue;
        expect(T[k] - beyond, `${name} band ${k}`).toBeLessThan(0.006);
        expect(T[k] - beyond, `${name} band ${k}`).toBeGreaterThanOrEqual(0);
      }
    };
    check('b', R.body);
    R.hatches.forEach((h, i) => check(`h${i}`, h.top, R.body));
  }, 60000);

  it('the hatches rise over the skin on the centre line; the turret sits on the middle one, clear of the saloon ceiling when stowed', () => {
    const R = TRAIN_ROOF, m = turretMount(S), T = TRAIN_TURRET_MEASURED;
    expect(R.hatches.map(h => h.x0)).toEqual([...R.hatches.map(h => h.x0)].sort((a, b) => a - b));
    for (const h of R.hatches) {
      expect(h.top[0]).toBeGreaterThan(TRAIN_ROOF_SKIN_Y + 0.07);
      expect(h.x1 - h.x0).toBeGreaterThan(0.4);
      expect(h.top).toHaveLength(Math.round(R.hatchZ / R.step));
    }
    const mid = R.hatches[1];
    expect(mid.top[0]).toBe(Math.max(...R.hatches.map(h => h.top[0])));
    // the base ring fits on the hatch along the car, and is bedded no more than 2 cm into its crowned top
    expect(T.baseRadius).toBe(0.215); // the radius the measuring tool laid the seat's disc out with
    expect(m.x - T.baseRadius).toBeGreaterThan(mid.x0);
    expect(m.x + T.baseRadius).toBeLessThan(mid.x1);
    expect(R.seat.hi - R.seat.lo).toBeLessThan(0.02);
    expect(roofTopAtPoint(m.x, 0, S)).toBeGreaterThanOrEqual(R.seat.hi);
    // a turret sunk by its whole height is still above the saloon ceiling (it never shows inside the car)
    expect(m.y - T.size.h).toBeGreaterThan(S.ceilingY);
  });

  it('the committed file is exactly what the measuring tool writes today', () => {
    const out = execFileSync(process.execPath, [repo('tools/asset-pipeline/train/measure-train-roof.mjs'), '--check'], {encoding: 'utf8'});
    expect(out).toContain('up to date');
  }, 60000);
});
