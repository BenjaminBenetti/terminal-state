#!/usr/bin/env node
// Iteration 07 (Lane W): before / after fit report from two fit-audit.mjs runs + the shipped GLBs.
//   node tools/asset-pipeline/zombie/qa/fit-report.mjs --before=FILE --after=FILE [--models=DIR] [--summary=FILE] [--md=FILE]
//   incremental (task mall-lingerie, new bodies): --merge=SUMMARY --after=FILE (audit of the NEW pairs only, e.g. --pairs=...)
//     keeps SUMMARY's before block and its after entries (pairs whose per-body variant meshes are byte-identical in the
//     rebuilt GLBs), adds / replaces the new audit's entries, re-hashes every live file and records the merge.
// Writes a compact, test-consumable summary of the AFTER audit (with the sha256 of every audited GLB,
// so a test can prove the numbers belong to the shipped files) and a markdown before/after table.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {liveModelFiles} from '../lib/live-files.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MERGE = args.merge ? JSON.parse(fs.readFileSync(path.resolve(REPO, args.merge), 'utf8')) : null;
const before = args.before ? JSON.parse(fs.readFileSync(path.resolve(REPO, args.before), 'utf8')) : null;
if (!before && !MERGE) throw new Error('--before=FILE (or --merge=SUMMARY) required');
const after = JSON.parse(fs.readFileSync(path.resolve(REPO, args.after), 'utf8'));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const SUMMARY = path.resolve(REPO, args.summary || 'game/public/assets/derivatives/zombie-wardrobe-fit-audit.json');
const MD = path.resolve(REPO, args.md || 'qa-artifacts/iter07-wardrobe/fit-report.md');
const slotOf = id => ({hardhat: 'head', cap: 'head', beanie: 'head', gasmask: 'face', respirator: 'face', cargo: 'lower', jeans: 'lower', slacks: 'lower'})[id] ?? 'upper';
const r4 = v => +(+v).toFixed(4);
const compact = r => r && !r.error ? {...(r.incompatible ? {incompatible: true} : {}), covered: r.coveredVertices, bind: r4(r.bind.maxPokeVisibleFrac), animated: r4(r.animatedMaxPokeVisibleFrac), animatedMean: r4(r.animatedMeanPokeVisibleFrac), extreme: r4(r.extremeMaxPokeVisibleFrac), maxExposedHidden: r.maxExposedHidden, everPokeVisibleVertices: r.everPokeVisibleVertices, regionPoke: r.regionPoke, worst: r.worst} : null;
const split = res => {
  const pairs = {}, layering = {}, bodyUnderLayers = {};
  for (const [k, r] of Object.entries(res)) {
    const c = compact(r); if (!c) continue;
    const m = /^(\w+):(\w+)\+(\w+)\|(\w+)$/.exec(k);
    if (!m) { pairs[k] = {slot: slotOf(k.split(':')[1]), ...c}; continue; }
    if (m[4] === 'body') bodyUnderLayers[`${m[1]}:${m[2]}+${m[3]}`] = c; else layering[`${m[1]}:${m[2]}+${m[3]}`] = c;
  }
  return {pairs, layering, bodyUnderLayers};
};
const A0 = split(after.results);
const A = MERGE ? {pairs: {...MERGE.after.pairs, ...A0.pairs}, layering: {...MERGE.after.layering, ...A0.layering}, bodyUnderLayers: {...MERGE.after.bodyUnderLayers, ...A0.bodyUnderLayers}} : A0;
const Bf = before ? split(before.results) : {pairs: MERGE.before.pairs, layering: {}, bodyUnderLayers: {}};
const files = {};
// T2.5 migration: hash the LIVE files (manifest / -t25), not every file matching the pattern
{ const live = liveModelFiles(MODELS); for (const abs of [...Object.values(live.bodies), ...Object.values(live.wearables)].sort()) files[path.basename(abs)] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); }
const agg = (o, slots) => { const l = Object.values(o).filter(x => !slots || slots.includes(x.slot)); const mx = f => +Math.max(0, ...l.map(x => x[f])).toFixed(4); const mean = f => l.length ? +(l.reduce((a, x) => a + x[f], 0) / l.length).toFixed(4) : 0; return {n: l.length, maxBind: mx('bind'), maxAnimated: mx('animated'), maxExtreme: mx('extreme'), meanAnimated: mean('animated'), totalEverPokeVisibleVertices: l.reduce((a, x) => a + x.everPokeVisibleVertices, 0)}; };
const summary = {
  schema: 'the-last-line/wardrobe-fit-audit@1', generatedAt: new Date().toISOString(),
  method: 'tools/asset-pipeline/zombie/qa/fit-audit.mjs on the shipped GLBs (every 2nd frame of all six clips + bind + 3 ragdoll-like extreme poses); lib/penetration.mjs: fraction of the covered OUTER-HULL body vertices (footwear excluded) that are VISIBLE (used by an unhidden triangle) and lie outside the cloth while the cloth\'s outward face is under the skin; layering = outer-wall pants vertices (not hidden by hideWear) poking through the upper',
  models: files, audit: {before: before ? before.models : MERGE.audit.before, after: MERGE ? MERGE.audit.after : after.models, every: after.every},
  ...(MERGE ? {merges: [...(MERGE.merges ?? []), {generatedAt: new Date().toISOString(), task: args.task ?? null, models: after.models, every: after.every,
    added: {pairs: Object.keys(A0.pairs).length, layering: Object.keys(A0.layering).length, bodyUnderLayers: Object.keys(A0.bodyUnderLayers).length}, keys: Object.keys(after.results).sort(),
    note: ['pairs', 'layering', 'bodyUnderLayers'].every(g => Object.keys(MERGE.after[g]).every(k => k in A0[g]))
      ? 'full re-audit of every shipped pair / layering on the rebuilt GLBs (the previous after block is fully replaced); the iteration-06 before block is kept from the previous summary'
      : 'incremental: only these keys were re-audited on the rebuilt GLBs; every other entry is the previous audit of per-body variant meshes that are byte-identical in the rebuilt files (verified by the merging task)'}]} : {}),
  after: {pairs: A.pairs, layering: A.layering, bodyUnderLayers: A.bodyUnderLayers,
    aggregate: {garments: agg(A.pairs, ['upper', 'lower']), headwear: agg(A.pairs, ['head']), face: agg(A.pairs, ['face'])}},
  before: before ? {pairs: Bf.pairs, aggregate: {garments: agg(Bf.pairs, ['upper', 'lower']), headwear: agg(Bf.pairs, ['head']), face: agg(Bf.pairs, ['face'])},
    layeringMaxAnimated: +Math.max(0, ...Object.values(Bf.layering).map(x => x.animated)).toFixed(4)} : MERGE.before,
};
fs.mkdirSync(path.dirname(SUMMARY), {recursive: true});
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1) + '\n');
// markdown table
const pct = v => v == null ? '-' : (100 * v).toFixed(2) + '%';
const lines = ['# Wardrobe fit audit: before (iteration 06) vs after (iteration 07)', '', `visible poke-through fraction of covered body vertices (bind / worst animated frame / worst ragdoll-like pose); after = shipped GLBs (${Object.keys(files).length} files hashed in ${path.relative(REPO, SUMMARY)})`, '',
  '| pair | slot | before bind | before anim | before extreme | after bind | after anim | after extreme | status |', '|---|---|---|---|---|---|---|---|---|'];
const keys = [...new Set([...Object.keys(Bf.pairs), ...Object.keys(A.pairs)])].sort((a, b) => slotOf(a.split(':')[1]).localeCompare(slotOf(b.split(':')[1])) || a.localeCompare(b));
for (const k of keys) { const b = Bf.pairs[k], a = A.pairs[k]; lines.push(`| ${k} | ${slotOf(k.split(':')[1])} | ${pct(b?.bind)} | ${pct(b?.animated)} | ${pct(b?.extreme)} | ${pct(a?.bind)} | ${pct(a?.animated)} | ${pct(a?.extreme)} | ${a ? 'shipped' : 'EXCLUDED'} |`); }
lines.push('', '## Layering (pants visibly poking through the upper)', '', '| body:upper+pants | before anim | after anim | status |', '|---|---|---|---|');
for (const k of [...new Set([...Object.keys(Bf.layering), ...Object.keys(A.layering)])].sort()) lines.push(`| ${k} | ${pct(Bf.layering[k]?.animated)} | ${pct(A.layering[k]?.animated)} | ${A.layering[k] ? (A.layering[k].incompatible ? 'per-body INCOMPATIBLE (never combined)' : 'allowed') : 'not shipped (pair excluded)'} |`);
lines.push('', '## Aggregates', '', '```', JSON.stringify({before: summary.before.aggregate, beforeLayeringMax: summary.before.layeringMaxAnimated, after: summary.after.aggregate}, null, 1), '```');
fs.mkdirSync(path.dirname(MD), {recursive: true});
fs.writeFileSync(MD, lines.join('\n') + '\n');
console.log('wrote', path.relative(REPO, SUMMARY), 'and', path.relative(REPO, MD));
console.log(JSON.stringify({before: summary.before.aggregate, after: summary.after.aggregate}, null, 1));
