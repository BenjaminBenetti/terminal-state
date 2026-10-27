// Iteration 07 (Lane P2) OPT-IN simulation (P7_SIM=1): the placement rules with a mocked catalog holding every manifest type at its
// manifest dims — validates the semantic dressing before (or independently of) the real models. Prints per-purpose/hall stats.
import {describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'reference/tasks/vertical-slice-iteration07-20261026/generation/manifest.json');
const RUN = process.env.P7_SIM === '1' && fs.existsSync(MANIFEST);

vi.mock('../src/gen/props07.catalog', async () => {
  const fs2 = await import('node:fs');
  const m = JSON.parse(fs2.readFileSync(MANIFEST, 'utf8')) as {assets: {key: string; realDimsMeters: {w: number; h: number; d: number}}[]};
  const models: Record<string, unknown> = {};
  for (const a of m.assets) {
    const {w, h, d} = a.realDimsMeters;
    // A plausible top surface for holders (sim only).
    models[a.key] = {url: `assets/models/p7-${a.key}.glb`, bytes: 400_000, w, h, d, tris: 3000, tex: 768, gpuBytes: 4_700_000, mode: 'MV', surfaces: [{y: Math.round(h * 0.95 * 1000) / 1000, x0: -w / 2 + 0.05, x1: w / 2 - 0.05, z0: -d / 2 + 0.05, z1: d / 2 - 0.05, clear: 0.5, area: w * d}]};
  }
  return {P7_MODELS: models};
});

describe.skipIf(!RUN)('iteration07 placement simulation (mocked catalog, manifest dims)', () => {
  it('places most types across sample seeds, keeps doors clear', async () => {
    const {generateStation} = await import('../src/gen/station');
    const {P7_KINDS, isP7Kind} = await import('../src/gen/props07');
    const {doorwayIntrusions} = await import('../src/gen/doorways');
    const seen = new Map<string, number>(), perSeed: number[] = [], byKey = new Map<string, Map<string, number>>();
    let intr = 0;
    const t0 = Date.now();
    const N = Number(process.env.P7_SEEDS ?? 12);
    for (let i = 0; i < N; i++) {
      const l = generateStation((i * 2654435761 + 777) >>> 0);
      const kinds = new Set<string>();
      for (const p of l.props) {
        if (!isP7Kind(p.kind)) continue;
        kinds.add(p.kind);
        seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
        const a = l.areas[p.area];
        const key = a.purpose ?? (a.type === 'concourse' ? (a.paid ? 'paid-concourse' : 'concourse') : a.type);
        let m = byKey.get(key); if (!m) byKey.set(key, (m = new Map()));
        m.set(p.kind, (m.get(p.kind) ?? 0) + 1);
      }
      perSeed.push(kinds.size);
      const di = doorwayIntrusions(l).filter(x => x.source === 'prop' && isP7Kind(x.ref.split('#')[0]));
      intr += di.length;
      if (di.length) console.log('doorway', l.seed, di.slice(0, 3));
    }
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    log(`kinds ${P7_KINDS.length}, seen ${seen.size}, per seed distinct ${perSeed.join(',')}, ${((Date.now() - t0) / N).toFixed(0)} ms/station`);
    log('never placed: ' + P7_KINDS.filter(k => !seen.has(k)).join(', '));
    for (const [k, m] of [...byKey].sort()) log(`${k}: ${[...m].sort((a, b) => b[1] - a[1]).map(([kk, n]) => `${kk}x${n}`).join(' ')}`);
    fs.writeFileSync('/tmp/p7-sim.txt', out.join('\n') + '\n');
    expect(intr).toBe(0);
    expect(seen.size).toBeGreaterThan(90);
  }, 600000);
});
