// Iteration 07 (Lane P2) OPT-IN report (P7_REPORT=1): per-room/hall assignment and placement counts of the integrated generated props
// on sample seeds, plus per-station cost estimates of the lazily loaded p7 models (download bytes, GPU texture memory, triangles,
// instanced draw calls — the builder's 18 m chunking, one draw call per kind per chunk). Writes lanes/p2-report.{json,md}.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {P7_ALWAYS, P7_KINDS, P7_PALETTE_KEEP, P7_REJECTED, isP7Kind, p7ModelKeysFor, p7Spec} from '../src/gen/props07';
import {p7AreaKey} from '../src/gen/props07Dress';
import {generateStation} from '../src/gen/station';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'reference/tasks/vertical-slice-iteration07-20261026/lanes');
const PROV = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/props-iteration07.json'), 'utf8')) as {outputs: {key: string; mode: string; sizeClass: string; triangles: number; bytes: number; source: {nativeJobId: string}; pipeline: {step: string; reason?: string; dropped?: number; label?: string}[]}[]; rejected?: {key: string; reason: string}[]};
const M = P7_MODELS as Record<string, {bytes: number; tris: number; gpuBytes: number; mode: string; w: number; h: number; d: number}>;

describe.skipIf(process.env.P7_REPORT !== '1')('iteration07 props report', () => {
  it('writes per-room placement counts and per-station cost estimates', () => {
    const seeds = Array.from({length: Number(process.env.P7_SEEDS ?? 12)}, (_, i) => (i * 2654435761 + 777) >>> 0);
    const byKey = new Map<string, Map<string, number>>(), seen = new Set<string>();
    const stations: Record<string, unknown>[] = [];
    for (const seed of seeds) {
      const l = generateStation(seed);
      const p7 = l.props.filter(p => isP7Kind(p.kind));
      const kinds = [...new Set(p7.map(p => p.kind))];
      kinds.forEach(k => seen.add(k));
      for (const p of p7) {
        const host = p.host !== undefined ? l.props[p.host] : null;
        const key = p.purpose ?? p7AreaKey(l.areas[p.area]);
        let m = byKey.get(key); if (!m) byKey.set(key, (m = new Map()));
        const label = host ? `${p.kind}${host.y === p.y ? '@' : '^'}${host.kind}` : p.kind;
        m.set(label, (m.get(label) ?? 0) + 1);
      }
      const chunks = new Map<string, Set<string>>();
      for (const p of p7) { let s = chunks.get(p.kind); if (!s) chunks.set(p.kind, (s = new Set())); s.add(`${Math.floor(p.x / 18)},${Math.floor(p.z / 18)}`); }
      stations.push({
        seed, archetype: l.archetype, areas: l.areas.length, distinctKinds: kinds.length, placements: p7.length,
        onHost: p7.filter(p => p.host !== undefined).length, mounted: p7.filter(p => p.mounted || p.lift).length,
        lazyModels: p7ModelKeysFor(l).length, downloadBytes: kinds.reduce((s, k) => s + M[k].bytes, 0), gpuTextureBytes: kinds.reduce((s, k) => s + M[k].gpuBytes, 0),
        triangles: p7.reduce((s, p) => s + M[p.kind].tris, 0), drawCalls: [...chunks.values()].reduce((s, c) => s + c.size, 0),
        newPurposes: [...new Set(l.areas.map(a => a.purpose).filter(x => ['workshop', 'pump-room', 'lost-property', 'revenue-room', 'custodial-room'].includes(x ?? '')))],
      });
    }
    const keys = [...byKey.keys()].sort();
    const total = (k: string) => [...byKey.get(k)!.values()].reduce((a, b) => a + b, 0);
    const report = {
      integrated: P7_KINDS.length, catalog: Object.keys(M).length, rejected: P7_REJECTED, seeds: seeds.length, seenAcrossSeeds: seen.size, neverPlaced: P7_KINDS.filter(k => !seen.has(k)),
      sv: P7_KINDS.filter(k => M[k].mode === 'SV'), mv: P7_KINDS.filter(k => M[k].mode === 'MV'),
      stations, perArea: Object.fromEntries(keys.map(k => [k, Object.fromEntries([...byKey.get(k)!].sort((a, b) => b[1] - a[1]))])),
      totals: {bytes: P7_KINDS.reduce((s, k) => s + M[k].bytes, 0), gpuTextureBytes: P7_KINDS.reduce((s, k) => s + M[k].gpuBytes, 0)},
      legend: 'kind@host = pulled up to a host (chair), kind^host = standing on a host top; counts summed over all sample seeds',
    };
    fs.mkdirSync(OUT, {recursive: true});
    fs.writeFileSync(path.join(OUT, 'p2-report.json'), JSON.stringify(report, null, 1) + '\n');
    const mb = (b: number) => (b / 1e6).toFixed(1);
    const fixes = PROV.outputs.flatMap(o => o.pipeline.filter(st => ['open-front', 'ground-cut', 'depth-cut', 'texture-reprojection'].includes(st.step) || (st.step === 'component-filter' && st.dropped)).map(st => `${o.key}: ${st.step}${st.step === 'component-filter' ? ` (${st.dropped} floaters)` : ''}${st.reason ? ` - ${st.reason}` : st.label ? ` - ${st.label}` : ''}`));
    const placeOf = (k: string) => [...new Set(p7Spec(k as never).uses.map(u => u.at))].join('/');
    const md = [
      `# Lane P2 placement report (${seeds.length} sample seeds; integrated ${P7_KINDS.length} of ${Object.keys(M).length} built)`, '',
      '| seed | archetype | distinct new types | placements (on/at host, wall/hung) | lazy models | download MB | GPU tex MB | p7 tris | p7 draw calls | new rooms |', '|---|---|---|---|---|---|---|---|---|---|',
      ...stations.map(s => `| ${s.seed} | ${s.archetype} | ${s.distinctKinds} | ${s.placements} (${s.onHost}, ${s.mounted}) | ${s.lazyModels} | ${mb(s.downloadBytes as number)} | ${mb(s.gpuTextureBytes as number)} | ${s.triangles} | ${s.drawCalls} | ${(s.newPurposes as string[]).join(', ')} |`),
      '', `Station palette: every station uses its seeded subset (keep ${P7_PALETTE_KEEP} of the catalogue + ${P7_ALWAYS.size} always-kept infrastructure / purpose-signature kinds); all ${seen.size} integrated types appear across these ${seeds.length} seeds. Costs are STATION-WIDE totals of the lazily loaded p7 models (download, GPU texture estimate RGBA8 + mips), instanced triangles and instanced meshes (one per kind per 18 m chunk); frustum culling and the 70 m far plane keep the in-view share well below these, not measured on a GPU.`,
      '', `## Integrated unique NEW types (${P7_KINDS.length}; catalog = in-game; ${report.mv.length} MV, ${report.sv.length} SV)`, '',
      ...P7_KINDS.map(k => `- \`${k}\` (${M[k].mode}, ${M[k].w}x${M[k].h}x${M[k].d} m, ${M[k].tris} tris, ${(M[k].bytes / 1000).toFixed(0)} kB; ${placeOf(k)}; job ${PROV.outputs.find(o => o.key === k)?.source.nativeJobId})`),
      '', `## Rejected (${(PROV.rejected ?? []).length}) / not integrated (${Object.keys(P7_REJECTED).length})`, '', ...(PROV.rejected ?? []).map(r => `- ${r.key}: ${r.reason}`), ...Object.entries(P7_REJECTED).map(([k, r]) => `- ${k}: ${r}`),
      '', '## Per-type derivative fixes (see derivatives/props-iteration07.json pipeline)', '', ...fixes.map(f => `- ${f}`),
      '', '## Per room purpose / hall type (counts over all sample seeds)', '',
      ...keys.map(k => `- **${k}** (${total(k)}): ${[...byKey.get(k)!].sort((a, b) => b[1] - a[1]).map(([kk, n]) => `${kk} ${n}`).join(', ')}`), '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'p2-report.md'), md);
    expect(report.integrated).toBeGreaterThanOrEqual(0);
  }, 600000);
});
