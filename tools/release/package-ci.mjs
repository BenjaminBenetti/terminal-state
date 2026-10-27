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
const MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 150 * 1024 * 1024, MAX_FILES = 1000;
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
        // Shader strings contain a literature citation on a // comment line.
        const nonCommentLines = s.split(/\r?\n/).filter(l => !/^\s*\/\/ https:\/\/jcgt\.org\/published\/0007\/04\/01\/\s*$/.test(l)).join('\n');
        if (!nsUse && /(?:https?:\/\/|\b(?:ftp|wss?):\/\/|^\/\/[^\s/])/i.test(nonCommentLines)) fail(`External runtime URL in ${rel}`);
        if (/^\/[^\s/]/.test(s)) fail(`Root-absolute runtime URL in ${rel}: ${s.slice(0,100)}`);
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
  if (all.length > MAX_FILES || !all.includes('index.html')) fail('Missing entry or too many files');
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
  const excludedUnreferencedModels = [];
  const files = all.filter(f => {
    if (!/^assets\/models\/[^/]+\.glb$/.test(f) || code.includes(f)) return true;
    excludedUnreferencedModels.push(f); return false;
  });
  const fileSet = new Set(files);
  for (const rel of files.filter(f => /\.(js|html|css)$/.test(f))) checkRuntime(fs.readFileSync(path.join(dist, rel), 'utf8'), rel, fileSet);
  const entries = files.map(rel => {
    const b = fs.readFileSync(path.join(dist, rel));
    return {path: rel, bytes: b.length, sha256: digest(b)};
  });
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (totalBytes > MAX_TOTAL) fail('Artifact total size limit exceeded');
  const manifest = {schema:'terminal-state-static-ci-v1', commit, entry:'index.html', base:'./',
    fileCount:entries.length, totalBytes, publicInputPolicySha256:digest(fs.readFileSync(path.join(root,'tools/release/public-inputs.json'))),
    checks:{publicInputsVerified:inputs.length, relativeUrls:true, noSymlinks:true, maxFileBytes:MAX_FILE, maxTotalBytes:MAX_TOTAL},
    excludedUnreferencedModels, files:entries};
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
  console.log(`Packaged ${m.fileCount} files / ${m.totalBytes} bytes for ${m.commit}; excluded ${m.excludedUnreferencedModels.length} unreferenced models.`);
}
