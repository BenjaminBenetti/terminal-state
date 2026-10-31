// Task loot-reference-pages-20261030 (lane SITE): output allowlist + leak checks for the generated reference site.
//
// validateSite() inspects the COMPLETE generated file set (path -> UTF-8 text) and returns every problem it finds (empty = valid).
// It is used by `npm run pages:check` (on dist/pages/ as written) and by game/tests/pages-output.test.ts (in memory).
// It is a policy check for this generator's own output, not a general HTML/JS sandbox:
//  - only allowlisted paths / extensions (html, css, js, json, one authored svg); no source maps, TypeScript, game bundle, models,
//    audio, images, archives, dotfiles or unexpected directories; bounded file count / sizes;
//  - no workspace paths, `reference/` task material, .git / node_modules / env files, key-like secrets or source-map markers;
//  - every internal link / asset resolves inside the site (including #fragments on nested pages), never root-absolute;
//  - external links only into the private source repository, each labelled "repository access required";
//  - basic accessibility structure (lang, title, skip link, one main + h1, captioned tables with header cells);
//  - JSON parses with finite numbers; the client script parses and makes no network / storage / eval calls;
//  - data/manifest.json lists exactly the other files with correct byte counts and SHA-256.
// Task enemy-spawn-tables-20261030 (lane SITE): + the Enemy spawns section (enemies/*.html, data/enemies.json): every page's site
// navigation reaches every section; COVERAGE: every level, generation context, family, room key and vocabulary term of
// data/enemies.json has its rendered anchor, and no enemies/ page exists without a level; the manifest's data digests match the
// published data files.
import crypto from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import type {EnemyReference} from './enemyReferenceTypes';
import {
  ctxAnchor, ENEMIES_FAMILIES, ENEMIES_HOW_TO, ENEMIES_INDEX, enemyLevelPage, familyAnchor, RESERVED_ENEMY_PAGES, roomAnchor, termAnchor,
  eligAnchor, // task track3-eaton-centre-20261031 (lane INTEG)
} from './render/enemies';
import {ACCESS_LABEL, href, NAV, SOURCE_REPO_URL} from './render/html';

export type SiteFiles = ReadonlyMap<string, string>;

// Runaway-output guards, not content budgets. Task track3-eaton-centre-20261031: raised from 1500 files / 6 MiB per file /
// 48 MiB total when the third level arrived. The mall has about twice the Office's holder kinds, so its per-table pages,
// loot/mall slot pages and data/loot.json grew past the old values (1510 files; loot.json 6.29 MB at 95bb812). Still far
// below GitHub Pages' own limits; still a hard failure for anything runaway.
export const SITE_LIMITS = {maxFiles: 3000, maxFileBytes: 12 * 1024 * 1024, maxTotalBytes: 96 * 1024 * 1024} as const;

/** Allowed output paths. Anything else (another extension, directory or name) is rejected. */
export const ALLOWED_PATHS: readonly RegExp[] = [
  /^(?:index|playtest)\.html$/,
  /^loot\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/){0,2}[a-z0-9]+(?:-[a-z0-9]+)*\.html$/,
  // Task enemy-spawn-tables-20261030 (lane SITE): the Enemy spawns section is flat: enemies/<page>.html only (no sub-directories).
  /^enemies\/[a-z0-9]+(?:-[a-z0-9]+)*\.html$/,
  /^assets\/(?:site\.css|site\.js|favicon\.svg)$/,
  /^data\/(?:loot|enemies|manifest)\.json$/,
];

const SEGMENT = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** Content that must never appear in any published file. */
const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/\/(?:workspaces|home|tmp|Users|root|private\/var)\//, 'absolute workstation path'],
  [/[A-Za-z]:\\(?:Users|Windows|workspaces)/i, 'absolute Windows path'],
  [/file:\/\//i, 'file:// URL'],
  [/(?<![\w-])reference\/(?:tasks|[A-Za-z0-9_-]+\/)/, 'reference/ task or archive path'],
  [/(?<![\w-])(?:qa-artifacts|node_modules|\.cache)\//, 'workspace-only directory path'],
  [/(?<![\w-])\.git(?:\/|\b(?!hub))/, '.git metadata path'],
  [/(?<![\w-])\.env(?:\b|\.)/, 'env file reference'],
  [/sourceMappingURL|\.js\.map\b|\.ts\.map\b/, 'source map'],
  [/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/, 'private key / certificate'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bmsy_[A-Za-z0-9]{16,}/, 'Meshy API key'],
  [/\b(?:MESHY_API_KEY|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|NPM_TOKEN)\b/, 'credential variable name'],
  [/\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i, 'key-like assignment'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/, 'bearer credential'],
];

/** TypeScript / module source markers that must not be published (the client script is a plain classic script). */
const SOURCE_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/^\s*import\s+(?:type\s+)?[{*\w].*\bfrom\s+['"]/m, 'ES module import'],
  [/^\s*export\s+(?:default\s+)?(?:const|function|class|interface|type|let|var|async)\b/m, 'ES module export'],
  [/^\s*(?:export\s+)?interface\s+\w+\s*(?:extends\s+[\w<>, ]+)?\s*\{/m, 'TypeScript interface'],
  [/\brequire\(\s*['"]/, 'CommonJS require'],
];

const sha256 = (text: string): string => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function idsOf(html: string): {ids: Set<string>; duplicates: string[]} {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const m of html.matchAll(/\sid="([^"]*)"/g)) {
    const id = unescapeAttr(m[1]!);
    if (ids.has(id)) duplicates.push(id);
    ids.add(id);
  }
  return {ids, duplicates};
}

function walkJson(value: unknown, at: string, problems: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(`${at}: non-finite number`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkJson(v, `${at}[${i}]`, problems));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkJson(v, `${at}.${k}`, problems);
  }
}

const REPO_LINK = new RegExp(
  `<a class="repo" href="(${SOURCE_REPO_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/(?:blob|commit)/[^"#?]+(?:#L\\d+)?)">[^<]*(?:<code>[^<]*</code>)?</a> <span class="access">\\(${ACCESS_LABEL}\\)</span>`,
  'g',
);

function checkHtml(file: string, html: string, files: SiteFiles, idCache: Map<string, Set<string>>, problems: string[]): void {
  const fail = (m: string) => problems.push(`${file}: ${m}`);
  if (!html.startsWith('<!doctype html>\n<html lang="en">\n')) fail('missing doctype / lang');
  if ((html.match(/<title>[^<]+<\/title>/g) ?? []).length !== 1) fail('needs exactly one <title>');
  if ((html.match(/<main id="main"/g) ?? []).length !== 1) fail('needs exactly one <main id="main">');
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) fail('needs exactly one <h1>');
  if (!html.includes('<a class="skip-link" href="#main">')) fail('missing skip link');
  if (!html.includes('<meta name="viewport"')) fail('missing viewport meta');
  if (!/<p class="build-id">Generated from the game source at commit .*data digest <code>[^<]+<\/code>/.test(html)) {
    fail('missing build identity (commit + data digest) footer');
  }
  if (/<(?:base|iframe|object|embed|form|img|video|audio|source|picture|frame|applet|portal)\b/i.test(html)) fail('disallowed element');
  if (/\son[a-z]+\s*=/i.test(html)) fail('inline event handler');
  if (/<(?![a-zA-Z/!])/.test(html)) fail('unescaped "<" in text');
  if (/\b(?:srcset|http-equiv|formaction|action|poster|background|ping)\s*=/i.test(html)) fail('disallowed attribute');
  if (/\s(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data):/i.test(html)) fail('script / data URL');
  if (/\bstyle\s*=\s*"[^"]*(?:url\(|expression\(|@import)/i.test(html) || /<style\b/i.test(html)) fail('disallowed inline style');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (m[2]!.trim()) fail('inline script');
    if (!/^ src="(?:\.\.\/)*assets\/site\.js" defer$/.test(m[1]!)) fail(`unexpected script tag <script${m[1]}>`);
  }
  // Visible text must not show rendering accidents.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  for (const bad of [/\bNaN\b/, /\bInfinity\b/, /\bundefined\b/, /\[object Object\]/]) {
    if (bad.test(text)) fail(`rendering artifact ${bad}`);
  }
  // Tables: caption + header cells.
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    if (!/<caption>[^<]*\S[^<]*<\/caption>/.test(t[0])) fail('table without a caption');
    if (!/<th\b/.test(t[0])) fail('table without header cells');
  }
  const {ids, duplicates} = idsOf(html);
  if (duplicates.length) fail(`duplicate ids: ${[...new Set(duplicates)].slice(0, 5).join(', ')}`);
  // Links.
  const repoLinks = new Set([...html.matchAll(REPO_LINK)].map(m => unescapeAttr(m[1]!)));
  const dir = path.posix.dirname(file);
  for (const m of html.matchAll(/\s(href|src)\s*=\s*(["'])(.*?)\2/gi)) {
    const value = unescapeAttr(m[3]!);
    if (value === '' || value === '#') { fail(`empty ${m[1]}`); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
      if (!repoLinks.has(value)) fail(`external URL not an allowed, labelled private-repository link: ${value.slice(0, 120)}`);
      continue;
    }
    if (value.startsWith('/') || value.startsWith('\\')) { fail(`root-absolute URL breaks under a project sub-path: ${value}`); continue; }
    if (value.includes('?')) { fail(`query string in internal link: ${value}`); continue; }
    const [target, fragment] = value.split('#') as [string, string | undefined];
    let resolved = file;
    if (target !== '') {
      if (target.endsWith('/')) { fail(`directory link (use …/index.html): ${value}`); continue; }
      resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
      if (resolved.startsWith('../') || resolved === '..' || path.posix.isAbsolute(resolved)) { fail(`link escapes the site root: ${value}`); continue; }
      if (!files.has(resolved)) { fail(`broken link: ${value} -> ${resolved}`); continue; }
    }
    if (fragment !== undefined) {
      if (!resolved.endsWith('.html')) { fail(`fragment on a non-page: ${value}`); continue; }
      let targetIds = idCache.get(resolved);
      if (!targetIds) {
        targetIds = idsOf(files.get(resolved)!).ids;
        idCache.set(resolved, targetIds);
      }
      if (!targetIds.has(decodeURIComponent(fragment))) fail(`broken fragment: ${value}`);
    }
  }
  if (repoLinks.size && !html.includes(`(${ACCESS_LABEL})`)) fail('private-repository links must be labelled');
  if (!ids.has('main')) fail('missing #main target');
  // Task enemy-spawn-tables-20261030 (lane SITE): the site navigation on every page reaches every section (loot, enemy spawns …).
  const siteNav = /<nav class="site-nav" aria-label="Site">([\s\S]*?)<\/nav>/.exec(html);
  if (!siteNav) fail('missing site navigation');
  else {
    const reached = new Set([...siteNav[1]!.matchAll(/\shref="([^"#]*)(?:#[^"]*)?"/g)]
      .map(m => path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, unescapeAttr(m[1]!) || path.posix.basename(file)))));
    for (const n of NAV) if (!reached.has(n.path)) fail(`site navigation does not link to ${n.path} (${n.label})`);
  }
}

function checkScript(file: string, js: string, problems: string[]): void {
  try {
    new vm.Script(js, {filename: file});
  } catch (e) {
    problems.push(`${file}: does not parse (${(e as Error).message})`);
  }
  const banned: ReadonlyArray<[RegExp, string]> = [
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, 'network access'],
    [/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/, 'dynamic code'],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, 'storage'],
    [/https?:\/\//, 'URL'],
    [/\.innerHTML\s*=|insertAdjacentHTML|document\.write/, 'HTML injection sink'],
  ];
  for (const [re, what] of banned) if (re.test(js)) problems.push(`${file}: ${what} is not allowed in the client script`);
}

/** Validate a complete generated site. Returns every problem (empty array = valid). */
export function validateSite(files: SiteFiles): string[] {
  const problems: string[] = [];
  const paths = [...files.keys()].sort();
  if (paths.length > SITE_LIMITS.maxFiles) problems.push(`too many files: ${paths.length}`);
  let total = 0;
  for (const required of ['index.html', 'playtest.html', 'loot/index.html', 'loot/how-to-read.html', 'assets/site.css', 'assets/site.js',
    'assets/favicon.svg', 'data/loot.json', 'data/manifest.json', ENEMIES_INDEX, ENEMIES_FAMILIES, ENEMIES_HOW_TO, 'data/enemies.json']) {
    if (!files.has(required)) problems.push(`missing required file ${required}`);
  }
  for (const file of paths) {
    const text = files.get(file)!;
    const size = bytes(text);
    total += size;
    if (!file.split('/').every(s => SEGMENT.test(s)) || !ALLOWED_PATHS.some(re => re.test(file))) {
      problems.push(`${file}: path not in the output allowlist`);
      continue;
    }
    if (size > SITE_LIMITS.maxFileBytes) problems.push(`${file}: ${size} bytes exceeds the per-file limit`);
    if (text.includes('\u0000')) problems.push(`${file}: NUL byte`);
    for (const [re, what] of FORBIDDEN) if (re.test(text)) problems.push(`${file}: ${what} (${re})`);
    if (!file.endsWith('.json')) for (const [re, what] of SOURCE_MARKERS) if (re.test(text)) problems.push(`${file}: ${what}`);
  }
  if (total > SITE_LIMITS.maxTotalBytes) problems.push(`site is ${total} bytes, over the total limit`);
  if (problems.length) return problems; // structural problems first; content checks below assume allowlisted paths

  const idCache = new Map<string, Set<string>>();
  for (const file of paths) {
    const text = files.get(file)!;
    if (file.endsWith('.html')) checkHtml(file, text, files, idCache, problems);
    else if (file.endsWith('.js')) checkScript(file, text, problems);
    else if (file.endsWith('.css')) {
      if (/@import|url\(|expression\(|https?:/i.test(text)) problems.push(`${file}: external resources / imports are not allowed in CSS`);
    } else if (file.endsWith('.svg')) {
      if (!text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) problems.push(`${file}: unexpected SVG root`);
      if (/<script|<foreignObject|\shref=|xlink:|\son[a-z]+\s*=|url\(/i.test(text)) problems.push(`${file}: active / linked SVG content`);
      if ((text.match(/https?:\/\/[^"\s]+/g) ?? []).some(u => u !== 'http://www.w3.org/2000/svg')) problems.push(`${file}: external URL in SVG`);
    } else if (file.endsWith('.json')) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (e) {
        problems.push(`${file}: invalid JSON (${(e as Error).message})`);
        continue;
      }
      walkJson(data, file, problems);
    }
  }

  // Manifest: exactly the other files, with sizes and hashes.
  const manifestText = files.get('data/manifest.json');
  if (manifestText) {
    try {
      const manifest = JSON.parse(manifestText) as {
        commit?: unknown; dataHash?: unknown; enemyDataHash?: unknown; files?: Array<{path: string; bytes: number; sha256: string}>;
      };
      const listed = manifest.files ?? [];
      const expected = paths.filter(p => p !== 'data/manifest.json');
      if (JSON.stringify(listed.map(f => f.path)) !== JSON.stringify(expected)) problems.push('data/manifest.json: file list differs from the site');
      for (const f of listed) {
        const text = files.get(f.path);
        if (text === undefined) continue;
        if (f.bytes !== bytes(text) || f.sha256 !== sha256(text)) problems.push(`data/manifest.json: size / hash mismatch for ${f.path}`);
      }
      if (typeof manifest.commit !== 'string' || !/^(?:[0-9a-f]{40}|local)$/.test(manifest.commit)) problems.push('data/manifest.json: bad commit');
      // The published data files are the ones the digests name, from the same commit.
      for (const [file, key] of [['data/loot.json', 'dataHash'], ['data/enemies.json', 'enemyDataHash']] as const) {
        const meta = readMeta(files.get(file));
        if (!meta) continue;
        if (manifest[key] !== meta.dataHash) problems.push(`data/manifest.json: ${key} does not match ${file}`);
        if (manifest.commit !== meta.commit) problems.push(`data/manifest.json: commit differs from ${file}`);
      }
    } catch {
      problems.push('data/manifest.json: unreadable');
    }
  }
  checkEnemyCoverage(files, idCache, problems);
  return problems;
}

function readMeta(text: string | undefined): {dataHash?: unknown; commit?: unknown} | null {
  if (text === undefined) return null;
  try {
    return (JSON.parse(text) as {meta?: {dataHash?: unknown; commit?: unknown}}).meta ?? null;
  } catch {
    return null;
  }
}

/**
 * Coverage of the Enemy spawns section against the published data/enemies.json: a level, generation context, family, room key or
 * vocabulary term without its rendered anchor is a problem, and so is an enemies/ page that no level of the data owns.
 */
function checkEnemyCoverage(files: SiteFiles, idCache: Map<string, Set<string>>, problems: string[]): void {
  const text = files.get('data/enemies.json');
  if (text === undefined) return;
  let ref: EnemyReference;
  try {
    ref = JSON.parse(text) as EnemyReference;
  } catch {
    return; // reported as invalid JSON above
  }
  const ids = (page: string): Set<string> => {
    let set = idCache.get(page);
    if (!set) {
      set = idsOf(files.get(page) ?? '').ids;
      idCache.set(page, set);
    }
    return set;
  };
  const need = (page: string, anchor: string, what: string) => {
    if (!files.has(page)) problems.push(`enemy coverage: ${what} has no page ${page}`);
    else if (!ids(page).has(anchor)) problems.push(`${page}: no rendered place for ${what} (#${anchor})`);
  };
  try {
    const levelPages = new Set<string>();
    const index = files.get(ENEMIES_INDEX) ?? '';
    for (const level of ref.levels) {
      const page = enemyLevelPage(level.id);
      levelPages.add(page);
      if (!files.has(page)) {
        problems.push(`enemy coverage: level ${level.id} has no page ${page}`);
        continue;
      }
      if (!index.includes(`href="${href(ENEMIES_INDEX, page)}"`)) problems.push(`${ENEMIES_INDEX}: does not link to level page ${page}`);
      for (const section of ['contexts', 'families', 'zombie-types', 'placement', 'rooms', 'census', 'knobs']) need(page, section, `section ${section} of ${level.id}`);
      if (level.levelMoves) need(page, 'storey-moves', `storey moves of ${level.id}`);
      for (const c of level.contexts) need(page, ctxAnchor(c.id), `context ${level.id}/${c.id}`);
      for (const f of ref.families) need(page, familyAnchor(f.id), `family ${f.id} in ${level.id}`);
      for (const r of level.rooms.rows) need(page, roomAnchor(r.room), `room key ${level.id}/${r.room}`);
      // task track3-eaton-centre-20261031 (lane PROFILES / INTEG): eligibility rules (with their spacing), the horde pool and ambient
      // budgets need their places
      const elig = level.pool?.eligibility ?? [];
      if (elig.length) need(page, 'eligibility', `family eligibility of ${level.id}`);
      for (const e of elig) need(page, eligAnchor(e.family), `eligibility rule ${level.id}/${e.family}`);
      if (level.horde) need(page, 'horde', `horde pool of ${level.id}`);
      if (level.budgets) need(page, 'ambient-budget', `ambient budget of ${level.id}`);
    }
    for (const f of ref.families) need(ENEMIES_FAMILIES, familyAnchor(f.id), `family ${f.id}`);
    for (const v of ref.vocabulary) need(ENEMIES_HOW_TO, termAnchor(v.term), `term ${v.term}`);
    const reserved = new Set(RESERVED_ENEMY_PAGES.map(n => `enemies/${n}.html`));
    for (const file of files.keys()) {
      if (file.startsWith('enemies/') && !reserved.has(file) && !levelPages.has(file)) problems.push(`${file}: enemy page without a level in data/enemies.json`);
    }
  } catch (e) {
    problems.push(`data/enemies.json: unexpected shape (${(e as Error).message})`);
  }
}

/** Manifest of a site's files (everything except the manifest itself), sorted by path. */
export function siteManifest(files: SiteFiles, meta: {commit: string; dataHash: string; enemyDataHash: string}): string {
  const list = [...files.keys()].filter(p => p !== 'data/manifest.json').sort()
    .map(p => ({path: p, bytes: bytes(files.get(p)!), sha256: sha256(files.get(p)!)}));
  return `${JSON.stringify({
    site: 'terminal-state-reference',
    note: 'Generated from the game source by tools/pages; byte counts and SHA-256 of every other published file.',
    commit: meta.commit,
    dataHash: meta.dataHash,
    enemyDataHash: meta.enemyDataHash,
    files: list,
  }, null, 1)}\n`;
}
