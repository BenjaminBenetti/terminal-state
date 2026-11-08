// Portable CI handoff. Does NOT invoke/relax the historical board/master hash guard.
// This independent path only accepts reviewed cooked public inputs by exact hash.
// Not a JS sandbox: dynamic URL construction still requires source review/browser QA.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
// Reuse Vite's already-locked parser; no dependency graph change.
import {parseAst} from 'rolldown/parseAst';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Task track3-eaton-centre-20261031 (lane PACKAGE): there is deliberately NO total-size cap. The artificial 150 MiB TOTAL
// limit was removed by user decision (2026-10-31: quality and playability first; no replacement total cap). The total is
// reported exactly (manifest totalBytes + report, console) instead. The per-file guard (MAX_FILE) and the file-count guard
// (MAX_FILES) stay, as do the allowlist / provenance / path / symlink / secret / runtime-URL checks below.
// Task studio-general-armor-20261107-231448-01 (lead, packaging): MAX_FILES bounds the ARTIFACT — the files actually shipped — not the
// local dist folder, which also holds the tracked-but-never-shipped inputs this packager already drops (unreferenced models /
// provenance JSON: 177 files at the time, all still allowlisted + hash-checked). Counting those let tracked provenance alone block a new
// legitimate runtime asset (dist sat at exactly 1000 while 823 files shipped).
export const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 1000;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { throw new Error(m); };
const safePath = p => typeof p === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)
  && !p.split('/').some(s => s.startsWith('.') || /(?:secret|credential|password|token)/i.test(s));
const publicPath = p => p === 'assets/CREDITS.md' || p === 'assets/audio/NOTICE.md'
  || /^assets\/models\/[\w-]+\.glb$/.test(p)
  || /^assets\/audio\/[\w-]+\.mp3$/.test(p)
  || /^assets\/derivatives\/[\w-]+\.json$/.test(p)
  || /^assets\/textures\/[\w/-]+\.(png|jpg)$/.test(p);
const bundlePath = p => /^assets\/index-[A-Za-z0-9_-]+\.(js|css)$/.test(p);

function walk(dir, base = dir) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) fail(`Not a real directory: ${dir}`);
  return fs.readdirSync(dir).sort().flatMap(name => {
    const f = path.join(dir, name), stat = fs.lstatSync(f), rel = path.relative(base, f).split(path.sep).join('/');
    if (stat.isSymbolicLink()) fail(`Symlink rejected: ${rel}`);
    if (stat.isDirectory()) {
      if (!safePath(rel)) fail(`Unsafe directory: ${rel}`);
      return walk(f, base);
    }
    if (!stat.isFile() || !safePath(rel)) fail(`Unsafe file: ${rel}`);
    if (stat.size > MAX_FILE) fail(`File size limit: ${rel}`);
    return [rel];
  });
}

// Iteration 13: three r186's WebGPURenderer bundle. Exact citation comment lines inside shader strings (iteration 06
// jcgt; WGSLNodeBuilder's polyfill credit), three exact shader-comment fragments and one exact console message text.
// None is ever requested; any other URL / root path still fails.
const SHADER_CITATION = /^\s*\/\/ https:\/\/(?:jcgt\.org\/published\/0007\/04\/01\/|www\.shadertoy\.com\/view\/WtyXRy)\s*$/;
// Shader-code comment fragments the node builders emit (DebugNode, NodeBuilder recursion guard): not paths.
const SHADER_COMMENT = new Set(['/*', '/* ... */ ', '/* Recursion detected. */']);
const INERT_TEXT = new Set([
  'Renderer: waitForGPU() has been removed. Read https://github.com/mrdoob/three.js/issues/32012 for more information.',
]);

export function checkRuntime(text, rel, files) {
  const local = value => {
    // The reviewed source embeds this exact inert SVG favicon; no remote fetch.
    if (value.startsWith('data:image/svg+xml,') && digest(value) === '66281e3e45aa881eef14ccbed4420a241da388383623d142812f65bd67f50c7d') return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value)) fail(`Nonrelative runtime URL in ${rel}: ${value.slice(0,100)}`);
    const clean = value.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!safePath(clean) || !files.has(clean)) fail(`Missing/unsafe runtime asset in ${rel}: ${value}`);
  };
  if (rel.endsWith('.html')) {
    if (/<(?:base|iframe|object|embed)\b/i.test(text) || /\bon[a-z]+\s*=/i.test(text)
      || /\b(?:srcset|http-equiv|poster|action|formaction|background)\s*=/i.test(text)
      || /\b(?:src|href)\s*=\s*[^\s"']/.test(text)) fail(`Unsafe HTML in ${rel}`);
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) local(m[2]);
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) checkRuntime(m[1], 'inline.css', files);
    for (const m of text.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)) checkRuntime(m[2], 'inline.css', files);
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) fail('Inline scripts rejected');
  } else if (rel.endsWith('.css')) {
    if (/@import\b/i.test(text)) fail('CSS imports rejected');
    for (const m of text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) local(m[1]);
  } else if (rel.endsWith('.js')) {
    const ast = parseAst(text, {}, rel);
    const pending = [[ast, null, null]];
    while (pending.length) {
      const [node, parent, grandparent] = pending.pop();
      const s = node.type === 'Literal' && typeof node.value === 'string' ? node.value
        : node.type === 'TemplateElement' ? node.value.cooked : null;
      if (typeof s === 'string') {
        // Three's createElementNS URI is an XML namespace, never a request.
        const namespace = s === 'http://www.w3.org/1999/xhtml' || s === 'http://www.w3.org/2000/svg';
        const literal = node.type === 'TemplateElement' && parent.expressions.length === 0 ? parent : node;
        const use = literal === parent ? grandparent : parent;
        const nsUse = namespace && use?.type === 'CallExpression' && use.arguments[0] === literal
          && use.callee.type === 'MemberExpression' && use.callee.property.name === 'createElementNS';
        // Shader strings contain literature citations on // comment lines (three's GLSL / WGSL builders); exact lines only.
        const nonCommentLines = s.split(/\r?\n/).filter(l => !SHADER_CITATION.test(l)).join('\n');
        if (!nsUse && !INERT_TEXT.has(s) && /(?:https?:\/\/|\b(?:ftp|wss?):\/\/|^\/\/[^\s/])/i.test(nonCommentLines)) fail(`External runtime URL in ${rel}`);
        if (/^\/[^\s/]/.test(s) && !SHADER_COMMENT.has(s)) fail(`Root-absolute runtime URL in ${rel}: ${s.slice(0,100)}`);
        if (/^(?:\.\/)?assets\/[A-Za-z0-9_/-]+\.(?:glb|mp3|png|jpg|json)$/.test(s)) local(s);
        if (use?.type === 'ImportDeclaration' || use?.type === 'ExportNamedDeclaration' || use?.type === 'ExportAllDeclaration'
          || use?.type === 'ImportExpression') local(s);
        if (['CallExpression','NewExpression'].includes(use?.type) && use.arguments[0] === literal
          && (['fetch','URL','Worker','WebSocket','EventSource'].includes(use.callee.name)
          || ['load','loadAsync'].includes(use.callee.property?.name))) local(s);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) { if (child?.type) pending.push([child,node,parent]); }
        else if (value?.type) pending.push([value,node,parent]);
      }
    }
  }
}

// Task track3-eaton-centre-20261031 (lane PACKAGE): transparent size reporting in the manifest (`report`) and the CI log.
// Deterministic (site-relative paths only, no timestamps). Families are PATH families, not runtime residency:
// assets/models/mall-*.glb + assets/textures/mall/** are mall-only (game/src/assets/levelAssets.ts fetches them only for the
// mall level); assets/models/office-*.glb + assets/textures/office/** are the office catalogue (its gear / medical models
// are used in every level and the mall's shops may reuse office / company props); everything else is shared.
const REPORT_TYPES = ['bundle', 'models', 'textures', 'audio', 'derivatives', 'notices'];
const REPORT_FAMILIES = ['mall', 'office', 'reactor', 'skyways', 'market', 'shared']; // task reactor-build-20261101 (lane ARCH): + the Reactor (levelAssets.ts LEVEL_ONLY_RULES); + the Survivor Market (task studio-survivor-market-20261108-005807-01)
const typeOf = rel => rel === 'index.html' || bundlePath(rel) ? 'bundle' : rel.startsWith('assets/models/') ? 'models'
  : rel.startsWith('assets/textures/') ? 'textures' : rel.startsWith('assets/audio/') && rel.endsWith('.mp3') ? 'audio'
  : rel.startsWith('assets/derivatives/') ? 'derivatives' : 'notices';
const familyOf = rel => /^assets\/(?:models\/mall-|textures\/mall\/)/.test(rel) ? 'mall'
  : /^assets\/(?:models\/office-|textures\/office\/)/.test(rel) ? 'office'
  : /^assets\/(?:models\/reactor-|textures\/reactor\/)/.test(rel) ? 'reactor'
  : /^assets\/(?:models\/skyways-|textures\/skyways\/)/.test(rel) ? 'skyways'
  : /^assets\/(?:models\/market-|textures\/market\/)/.test(rel) ? 'market' : 'shared'; // (reactor-build, lane ARCH; + skyways; + market)
const tally = keys => Object.fromEntries(keys.map(k => [k, {files: 0, bytes: 0}]));
export function sizeReport(entries, excludedBytes = [], excludedProvenanceBytes = []) {
  const byType = tally(REPORT_TYPES), models = tally(REPORT_FAMILIES), textures = tally(REPORT_FAMILIES);
  for (const e of entries) {
    const t = typeOf(e.path), fam = t === 'models' ? models : t === 'textures' ? textures : null;
    byType[t].files++; byType[t].bytes += e.bytes;
    if (fam) { fam[familyOf(e.path)].files++; fam[familyOf(e.path)].bytes += e.bytes; }
  }
  const largestFiles = [...entries].sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1)).slice(0, 5).map(e => ({path: e.path, bytes: e.bytes}));
  return {byType, levelFamilies: {models, textures}, largestFiles,
    excludedUnreferencedModelBytes: excludedBytes.reduce((s, b) => s + b, 0),
    excludedUnreferencedProvenanceBytes: excludedProvenanceBytes.reduce((s, b) => s + b, 0)};
}

// Advisory only — NOT a CI limit: the existing static playtest host accepts at most 200 MiB. Above it, Main serves the same
// official artifact through the dynamic app (tools/deploy/dynamic-app/CONTRACT.md). Printed so the CI log says which applies.
export const STATIC_HOST_ADVISORY_BYTES = 200 * 1024 * 1024;
const fmt = v => v.toLocaleString('en-US');
export function reportLines(m) {
  const r = m.report, part = o => Object.entries(o).map(([k, v]) => `${k} ${fmt(v.files)} / ${fmt(v.bytes)} B`).join(' · ');
  const fits = m.totalBytes <= STATIC_HOST_ADVISORY_BYTES;
  return [
    `Packaged ${fmt(m.fileCount)} files / ${fmt(m.totalBytes)} bytes (${(m.totalBytes / 1048576).toFixed(2)} MiB) for ${m.commit}; no total-size cap (per file <= ${fmt(m.checks.maxFileBytes)} B, <= ${fmt(m.checks.maxFiles)} files).`,
    `  by type: ${part(r.byType)}`,
    `  models by family: ${part(r.levelFamilies.models)}`,
    `  textures by family: ${part(r.levelFamilies.textures)}`,
    `  largest: ${r.largestFiles.map(e => `${e.path} ${fmt(e.bytes)} B`).join(', ')}`,
    `  excluded ${m.excludedUnreferencedModels.length} unreferenced models (${fmt(r.excludedUnreferencedModelBytes)} B; tracked build inputs, not shipped).`,
    `  excluded ${(m.excludedUnreferencedProvenance ?? []).length} unreferenced provenance JSON (${fmt(r.excludedUnreferencedProvenanceBytes ?? 0)} B; tracked provenance, not shipped).`,
    `  delivery advisory (not a CI limit): static host max ${fmt(STATIC_HOST_ADVISORY_BYTES)} B — ${fits
      ? `fits (${fmt(STATIC_HOST_ADVISORY_BYTES - m.totalBytes)} B headroom)`
      : `exceeds by ${fmt(m.totalBytes - STATIC_HOST_ADVISORY_BYTES)} B: use the dynamic app (tools/deploy/dynamic-app/CONTRACT.md)`}.`,
  ];
}

export function packageSite({root = ROOT, commit, output} = {}) {
  const dist = path.join(root, 'dist/game'), pub = path.join(root, 'game/public');
  output ??= path.join(root, 'artifacts/terminal-state-web');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) fail('A full 40-hex source commit is required');
  if (fs.existsSync(output)) fail(`Output already exists: ${output}; remove only this generated artifact directory explicitly`);
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'tools/release/public-inputs.json'), 'utf8'));
  if (policy.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(policy.files)) fail('Unknown public-input policy');
  const allowed = new Map();
  for (const e of policy.files) {
    if (!safePath(e.path) || !publicPath(e.path) || allowed.has(e.path) || !/^[a-f0-9]{64}$/.test(e.sha256)
      || !Number.isSafeInteger(e.bytes) || e.bytes < 1 || e.bytes > MAX_FILE) fail(`Invalid allowed public input: ${e.path}`);
    allowed.set(e.path, e);
  }
  const inputs = walk(pub);
  if (inputs.length !== allowed.size) fail('Public input count changed; review policy explicitly');
  for (const rel of inputs) {
    const b = fs.readFileSync(path.join(pub, rel)), e = allowed.get(rel);
    if (!e || e.bytes !== b.length || e.sha256 !== digest(b)) fail(`Unreviewed public input: ${rel}`);
  }
  const all = walk(dist);
  if (!all.includes('index.html')) fail('Missing entry or too many files');
  for (const rel of all) {
    if (rel !== 'index.html' && !bundlePath(rel) && !allowed.has(rel)) fail(`Unallowlisted output: ${rel}`);
    if (allowed.has(rel)) {
      const b = fs.readFileSync(path.join(dist, rel)), e = allowed.get(rel);
      if (b.length !== e.bytes || digest(b) !== e.sha256) fail(`Changed public copy: ${rel}`);
    }
  }
  for (const rel of allowed.keys()) if (!all.includes(rel)) fail(`Missing public copy: ${rel}`);
  if (all.filter(p => bundlePath(p) && p.endsWith('.js')).length !== 1
    || all.filter(p => bundlePath(p) && p.endsWith('.css')).length !== 1) fail('Expected exactly one game JS and CSS entry');
  // Deliberately IDENTICAL to the old helper's --drop-unreferenced-models rule.
  const code = all.filter(f => /\.(js|html)$/.test(f)).map(f => fs.readFileSync(path.join(dist, f), 'utf8')).join('\n');
  const excludedUnreferencedModels = [], excludedUnreferencedProvenance = [];
  const files = all.filter(f => {
    if (/^assets\/models\/[^/]+\.glb$/.test(f) && !code.includes(f)) { excludedUnreferencedModels.push(f); return false; }
    // Task reactor-surface-ending-20261102 (lead, release capacity): the same rule for the provenance JSON under assets/derivatives/
    // (tracked build provenance; CREDITS.md + audio/NOTICE.md carry the shipped notices). A provenance file no runtime code names
    // by path is never fetched by the game: it stays in Git / game/public (still allowlisted + hash-checked above), not shipped.
    if (/^assets\/derivatives\/[^/]+\.json$/.test(f) && !code.includes(f)) { excludedUnreferencedProvenance.push(f); return false; }
    return true;
  });
  if (files.length > MAX_FILES) fail(`Missing entry or too many files: ${files.length} shipped outputs exceed ${MAX_FILES}`);
  const fileSet = new Set(files);
  for (const rel of files.filter(f => /\.(js|html|css)$/.test(f))) checkRuntime(fs.readFileSync(path.join(dist, rel), 'utf8'), rel, fileSet);
  const entries = files.map(rel => {
    const b = fs.readFileSync(path.join(dist, rel));
    return {path: rel, bytes: b.length, sha256: digest(b)};
  });
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  // No total cap (see MAX_FILE above): `maxTotalBytes: null` states it explicitly for manifest readers.
  const manifest = {schema:'terminal-state-static-ci-v1', commit, entry:'index.html', base:'./',
    fileCount:entries.length, totalBytes, publicInputPolicySha256:digest(fs.readFileSync(path.join(root,'tools/release/public-inputs.json'))),
    checks:{publicInputsVerified:inputs.length, relativeUrls:true, noSymlinks:true, maxFileBytes:MAX_FILE, maxFiles:MAX_FILES, maxTotalBytes:null},
    report:sizeReport(entries, excludedUnreferencedModels.map(rel => fs.statSync(path.join(dist, rel)).size),
      excludedUnreferencedProvenance.map(rel => fs.statSync(path.join(dist, rel)).size)),
    excludedUnreferencedModels, excludedUnreferencedProvenance, files:entries};
  for (const e of entries) {
    const dest = path.join(output, 'site', e.path);
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.copyFileSync(path.join(dist,e.path), dest);
    if (digest(fs.readFileSync(dest)) !== e.sha256) fail(`Copy mismatch: ${e.path}`);
  }
  fs.writeFileSync(path.join(output,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const m = packageSite({commit});
  for (const line of reportLines(m)) console.log(line);
}
