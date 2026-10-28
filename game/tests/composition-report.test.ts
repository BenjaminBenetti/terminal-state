// Iteration 08 (Lane P) OPT-IN report (P8_REPORT=1): per-seed prop counts / costs of the COMPOSED multi-level stations against the
// iteration-7 baseline (same 12 seeds, same metric code, measured on commit d9bbe2f), cluster / landmark catalogue use per zone and
// level, openable-holder counts for Lane I. Writes reference/tasks/vertical-slice-iteration08-20261027/lanes/p2-report.{json,md}.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {isP7Kind} from '../src/gen/props07';
import {generateStation} from '../src/gen/station';
import {CLUSTERS, ZONE_RULES, compositionOf} from '../src/gen/compose';
import {levelsOf} from '../src/gen/placeKit';
import {isLootHolderKind} from '../src/items/loot';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'reference/tasks/vertical-slice-iteration08-20261027/lanes');
const M = P7_MODELS as Record<string, {bytes: number; tris: number; gpuBytes: number}>;

/**
 * Iteration-7 baseline per seed (commit d9bbe2f, identical metric code): [placements, p7 placements, distinct kinds, distinct p7
 * kinds, draw-call estimate (kind x 18 m chunk, all props), p7 draw calls, p7 tris, p7 GPU texture MB, p7 download MB, holders].
 */
const BASE: Record<string, number[]> = {"777":[562,207,104,60,364,183,695262,229.6,27.0,170],"2654436538":[559,186,97,50,365,168,669362,195.0,22.9,153],"1013905003":[718,248,100,56,428,209,842543,207.3,24.7,238],"3668340764":[458,141,85,45,292,128,505662,171.3,20.6,130],"2027809229":[643,210,100,58,407,189,720884,219.9,26.2,198],"387277694":[553,179,102,55,332,151,601684,208.3,24.6,161],"3041713455":[507,148,91,48,297,121,521374,188.4,22.0,171],"1401181920":[500,163,94,53,297,142,546973,197.5,23.4,204],"4055617681":[639,224,99,58,405,195,769441,220.6,26.2,191],"2415086146":[581,184,96,51,347,157,619561,186.3,22.3,238],"774554611":[501,164,94,52,303,141,598224,206.2,24.4,149],"3428990372":[568,160,95,49,326,128,518986,187.0,21.6,252]};
/** Iteration-7 totals over the 12 seeds of the kinds Lane I makes openable / Lane S stocks. */
const BASE_KINDS: Record<string, number> = {"bin":412,"wheelieBin":39,"staffLockers":31,"gunLocker":14,"filingCabinet":20,"rollingToolChest":12,"shopCooler":212,"fridge":15,"chestFreezer":3,"newspaperVendingBox":42,"cabinetTall":64,"cabinetLow":38,"crate":176,"stockShelf":504,"shelf":32,"snackRack":19,"magazineRack":18,"shopDisplay":160,"breadRack":1,"deviceWall":8,"showcase":8,"spinnerRack":14,"vending":164};

const pct = (n: number, b: number) => `${n >= b ? '+' : ''}${Math.round((n - b) / b * 100)}%`;

describe.skipIf(process.env.P8_REPORT !== '1')('iteration08 composition report', () => {
  it('writes per-seed counts vs the iteration-7 baseline, cluster use per zone / level, holder counts', () => {
    const seeds = Object.keys(BASE).map(Number);
    const rows: Record<string, unknown>[] = [];
    const byZone = new Map<string, Map<string, number>>(), byLevel = new Map<number, Map<string, number>>();
    const kinds: Record<string, number> = {};
    let genMs = 0;
    for (const seed of seeds) {
      const t0 = performance.now();
      const l = generateStation(seed);
      genMs += performance.now() - t0;
      const sum = compositionOf(l)!;
      const p7 = l.props.filter(p => isP7Kind(p.kind));
      const p7k = new Set(p7.map(p => p.kind));
      const chunks = (list: typeof l.props) => { const m = new Map<string, Set<string>>(); for (const p of list) { let s = m.get(p.kind); if (!s) m.set(p.kind, (s = new Set())); s.add(`${Math.floor(p.x / 18)},${Math.floor(p.z / 18)}`); } return [...m.values()].reduce((a, s) => a + s.size, 0); };
      for (const c of sum.clusters) {
        let z = byZone.get(c.zone); if (!z) byZone.set(c.zone, (z = new Map())); z.set(c.type, (z.get(c.type) ?? 0) + 1);
        let v = byLevel.get(c.level); if (!v) byLevel.set(c.level, (v = new Map())); v.set(c.type, (v.get(c.type) ?? 0) + 1);
      }
      for (const p of l.props) if (p.kind in BASE_KINDS) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      const lv = (n: number) => l.props.filter(p => (p.level ?? 0) === n).length;
      rows.push({
        seed, archetype: l.archetype, attempt: l.attempt, levels: levelsOf(l).length, placements: l.props.length, byLevel: [lv(0), lv(1), lv(2)], p7: p7.length, kinds: new Set(l.props.map(p => p.kind)).size, p7Kinds: p7k.size,
        draws: chunks(l.props), drawsP7: chunks(p7), p7Tris: p7.reduce((s, p) => s + M[p.kind].tris, 0), texMB: [...p7k].reduce((s, k) => s + M[k].gpuBytes, 0) / 1e6, dlMB: [...p7k].reduce((s, k) => s + M[k].bytes, 0) / 1e6,
        holders: l.props.filter(p => isLootHolderKind(p.kind)).length, clusters: sum.clusters.length, landmarks: sum.landmarks.length, covers: sum.clusters.filter(c => c.cover).length,
        rewards: sum.clusters.filter(c => c.reward).length, rewardsOffMain: sum.clusters.filter(c => c.reward && c.level !== 0).length, composedProps: l.props.filter(p => p.cluster !== undefined).length,
      });
    }
    const report = {
      seeds, generatedMsAvg: Math.round(genMs / seeds.length), baselineCommit: 'd9bbe2fa5789d215b4252effe2ae244f9039e2a8', rows,
      clustersByZone: Object.fromEntries([...byZone].map(([z, m]) => [z, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))])),
      clustersByLevel: Object.fromEntries([...byLevel].map(([z, m]) => [z, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))])),
      holderKinds: Object.fromEntries(Object.keys(BASE_KINDS).map(k => [k, {iteration7: BASE_KINDS[k], iteration8: kinds[k] ?? 0}])),
    };
    fs.mkdirSync(OUT, {recursive: true});
    fs.writeFileSync(path.join(OUT, 'p2-report.json'), JSON.stringify(report, null, 1) + '\n');
    const f1 = (v: number) => v.toFixed(1);
    const md = [
      `# Lane P composition report — iteration 8 vs iteration 7 (${seeds.length} seeds, same metric code)`, '',
      `Baseline: iteration 7 at \`${report.baselineCommit.slice(0, 7)}\` (single level). Iteration 8: the current tree (multi-level stations from Lane A + Lane P composition). `
        + `Draw calls = one instanced mesh per kind per 18 m chunk (the builder's chunking, all props); p7 tris / texture / download = the lazily loaded iteration-7 models a station places. Not GPU measurements.`, '',
      '| seed | archetype | levels | placements (L0/L1/L2) | Δ | distinct kinds | p7 kinds | draw calls | Δ | p7 tris | Δ | p7 tex MB | Δ | holders | clusters | landmarks | cover | rewards (off main) |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map(r => {
        const b = BASE[String(r.seed)];
        const by = r.byLevel as number[];
        return `| ${r.seed} | ${r.archetype} | ${r.levels} | ${r.placements} (${by.join('/')}) | ${pct(r.placements as number, b[0])} | ${r.kinds} (${b[2]}) | ${r.p7Kinds} (${b[3]}) | ${r.draws} | ${pct(r.draws as number, b[4])} | ${r.p7Tris} | ${pct(r.p7Tris as number, b[6])} | ${f1(r.texMB as number)} | ${pct(r.texMB as number, b[7])} | ${r.holders} (${b[9]}) | ${r.clusters} | ${r.landmarks} | ${r.covers} | ${r.rewards} (${r.rewardsOffMain}) |`;
      }),
      '', `Average generation time (this machine, vitest, incl. validation retries): ${report.generatedMsAvg} ms per station.`, '',
      '## Openable / stocked fixture kinds (12-seed totals; Lane I / Lane S)', '',
      '| kind | iteration 7 | iteration 8 |', '|---|---|---|',
      ...Object.entries(report.holderKinds).map(([k, v]) => `| ${k} | ${v.iteration7} | ${v.iteration8} |`),
      '', '## Clusters per zone (12-seed totals)', '',
      ...Object.entries(report.clustersByZone).map(([z, m]) => `- **${z}** — ${ZONE_RULES[z as keyof typeof ZONE_RULES]?.label ?? ''}: ${Object.entries(m).map(([k, n]) => `${k} ${n}`).join(', ')}`),
      '', '## Clusters per level', '',
      ...Object.entries(report.clustersByLevel).map(([z, m]) => `- **level ${z}**: ${Object.entries(m).map(([k, n]) => `${k} ${n}`).join(', ')}`),
      '', '## Cluster catalogue', '',
      ...Object.values(CLUSTERS).map(c => `- \`${c.id}\` (${c.form}; zones ${c.zones.join(', ')}; spacing ${c.spacing} m${c.cover ? '; cover' : ''}${c.reward ? '; reward' : ''}): ${c.story}`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'p2-report.md'), md);
    expect(rows.length).toBe(seeds.length);
  }, 600000);
});
