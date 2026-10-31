// Task mall-playtest-revision-20261031 (lane PROFILES, D07): bounded SIREN census of the compact mall (CPU only).
// Each mall is generated ONCE through the registry (LEVELS.mall.generate, pistol start); the family roll is a hash of (level seed,
// spawn index) and placement never reads families, so the sweep re-runs only assignEnemyArchetypes + applyFamilySpacing on the same
// layout per (draw weight, cap, spacing) — then restores the live profile's assignment (checked equal to the generated one).
// Seeds: tuning 9100 + 104729 k (k = 0..23), validation 50021 + 7919 k (k = 0..23) — 48 malls.
// Run (copied transiently into game/tests/ as zz-siren-sweep.test.ts, then removed):
//   reference/tasks/office-overhaul-20261030/tools/heavy.sh ./node_modules/.bin/vitest run --config game/vitest.config.ts \
//     --maxWorkers=1 --no-file-parallelism game/tests/zz-siren-sweep.test.ts
import {expect, it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, eligibilityFailure, familyPool, spawnContextOf, spawnProfile, type SpawnProfile} from '../src/ai/spawnTables';
import {assignEnemyArchetypes} from '../src/ai/creatureSpawn';
import {applyFamilySpacing} from '../src/ai/familySpacing';

const DIR = new URL('../../reference/tasks/mall-playtest-revision-20261031/evidence/census/', import.meta.url);
const TUNE = Array.from({length: 24}, (_, k) => (9100 + 104729 * k) >>> 0);
const VALID = Array.from({length: 24}, (_, k) => (50021 + 7919 * k) >>> 0);
const WEIGHTS = [0.2, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8];
const CAPS = [1, 2, 3];
const SPACINGS = [20, 30];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

it('siren sweep', () => {
  const P = spawnProfile('mall');
  const t0 = Date.now();
  const malls = [...TUNE.map(s => ({seed: s, set: 'tune'})), ...VALID.map(s => ({seed: s, set: 'valid'}))].map(m => ({...m, l: LEVELS.mall.generate('main', {levelSeed: m.seed, startWeapon: 'pistol'})}));
  const genMs = Date.now() - t0;
  const ambientIdx = (l: StationLayout) => l.zombies.map((_, i) => i).filter(i => l.zombies[i].horde === undefined && spawnContextOf(l, P, i) !== 'service' && !l.areas[l.zombies[i].area]?.ext);
  const facts = malls.map(m => {
    const amb = ambientIdx(m.l);
    const elig = amb.filter(i => eligibilityFailure(MALL_SIREN_ELIGIBILITY, m.l, m.l.zombies[i], spawnContextOf(m.l, P, i)) === null);
    return {seed: m.seed, set: m.set, variant: m.l.mall!.variant, ambient: amb.length, eligible: elig.length, eligibleByStorey: elig.map(i => m.l.zombies[i].level ?? 0),
      live: m.l.zombies.map(z => z.archetype)};
  });
  const run = (w: number, cap: number, sp: number, set: string) => {
    const Q: SpawnProfile = {...P, families: familyPool({siren: w}), eligibility: {siren: {...MALL_SIREN_ELIGIBILITY, maxPerLevel: cap}}, spacing: {siren: {...MALL_SIREN_SPACING, spacingM: sp}}};
    const per: {n: number; storeys: number[]; amb: number; bb: number; rd: number}[] = [];
    for (const m of malls) {
      if (set !== 'all' && m.set !== set) continue;
      assignEnemyArchetypes(m.l, Q);
      applyFamilySpacing(m.l, Q);
      const amb = ambientIdx(m.l).map(i => m.l.zombies[i]);
      const s = amb.filter(z => z.archetype === 'siren');
      per.push({n: s.length, storeys: s.map(z => z.level ?? 0), amb: amb.length, bb: amb.filter(z => z.archetype === 'blightbelly').length, rd: amb.filter(z => z.archetype === 'ratdog').length});
    }
    const n = per.length, tot = per.reduce((a, p) => a + p.n, 0), amb = per.reduce((a, p) => a + p.amb, 0);
    const hist: Record<string, number> = {};
    for (const p of per) hist[p.n] = (hist[p.n] ?? 0) + 1;
    const storeys: Record<string, number> = {};
    for (const p of per) for (const s of p.storeys) storeys[s] = (storeys[s] ?? 0) + 1;
    return {weight: w, cap, spacingM: sp, set, runs: n, mean: r3(tot / n), placedShare: r3(tot / amb), noneShare: r3(per.filter(p => p.n === 0).length / n), max: Math.max(...per.map(p => p.n)),
      atCapShare: r3(per.filter(p => p.n >= cap).length / n), hist, perStorey: storeys,
      blightbellyShare: r3(per.reduce((a, p) => a + p.bb, 0) / amb), ratdogShare: r3(per.reduce((a, p) => a + p.rd, 0) / amb)};
  };
  const sweep = [];
  for (const w of WEIGHTS) for (const cap of CAPS) for (const sp of SPACINGS) for (const set of ['tune', 'valid', 'all']) sweep.push(run(w, cap, sp, set));
  // restore the live assignment and check it equals the generated one
  for (const m of malls) { assignEnemyArchetypes(m.l, P); applyFamilySpacing(m.l, P); }
  malls.forEach((m, k) => expect(m.l.zombies.map(z => z.archetype)).toEqual(facts[k].live));
  const live = run(Object.fromEntries(P.families).siren as number, P.eligibility!.siren!.maxPerLevel!, P.spacing!.siren!.spacingM, 'all');
  for (const m of malls) { assignEnemyArchetypes(m.l, P); applyFamilySpacing(m.l, P); }
  const out = {
    task: 'studio-beta-mall-playtest-revision-20261031-01 (lane PROFILES)', generatedAt: new Date().toISOString(), generationMs: genMs,
    method: '48 malls generated once via LEVELS.mall.generate (pistol start; seeds tuning 9100 + 104729k, validation 50021 + 7919k, k = 0..23); per (weight, cap, spacing) assignEnemyArchetypes + applyFamilySpacing re-run on the same layouts (the roll is a hash of (seed, index); layouts never read families); ambient = core non-horde spawns (annex service spawns excluded).',
    live: {weight: live.weight, cap: live.cap, spacingM: live.spacingM, result: live},
    eligibleSlots: {mean: r3(facts.reduce((a, f) => a + f.eligible, 0) / facts.length), perRun: facts.map(f => f.eligible), ambientMean: r3(facts.reduce((a, f) => a + f.ambient, 0) / facts.length),
      byStorey: facts.flatMap(f => f.eligibleByStorey).reduce((o: Record<string, number>, s) => { o[s] = (o[s] ?? 0) + 1; return o; }, {})},
    perMall: facts.map(f => ({seed: f.seed, set: f.set, variant: f.variant, ambient: f.ambient, eligible: f.eligible})),
    sweep,
  };
  mkdirSync(DIR, {recursive: true});
  const file = new URL('siren-sweep.json', DIR);
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  process.stdout.write(`[siren-sweep] ${malls.length} malls in ${genMs} ms; eligible slots ${out.eligibleSlots.mean}/run; live ${JSON.stringify(live)} -> ${file.pathname}\n`);
}, 900000);
