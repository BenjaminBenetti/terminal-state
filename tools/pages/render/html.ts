// Task loot-reference-pages-20261030 (lane SITE): HTML primitives and the shared page shell of the static reference site.
//
// Everything here is pure string building: no DOM, no timestamps, no environment reads. Every internal link is RELATIVE (computed
// from the page's own site path), so the same output works under https://benjaminbenetti.github.io/terminal-state/, any other
// sub-path, a local static server and file://. Links point at explicit `…/index.html` files for the same reason.
// Task enemy-spawn-tables-20261030 (lane SITE): + the "Enemy spawns" section in the site nav and the enemy data digest in the footer.
import path from 'node:path';

/** The private source repository. Links into it are always labelled "repository access required". */
export const SOURCE_REPO_URL = 'https://github.com/BenjaminBenetti/terminal-state';
export const ACCESS_LABEL = 'repository access required';

const ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
/** Escape text for HTML element content and double-quoted attributes. */
export const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, c => ESCAPES[c]!);

/** Site-relative href from page `from` to site path `to` (optionally with a #fragment). Both are posix paths without a leading slash. */
export function href(from: string, to: string): string {
  const [target, fragment] = to.split('#') as [string, string | undefined];
  const suffix = fragment === undefined ? '' : `#${fragment}`;
  if (target === '' || target === from) return suffix || path.posix.basename(from);
  const rel = path.posix.relative(path.posix.dirname(from), target);
  return rel + suffix;
}

/** Stable, readable HTML id / file slug: lowercase ASCII letters, digits and single hyphens. */
export function slug(value: string): string {
  const s = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'x';
}

/** Short commit for display; anything that is not a full hex SHA is shown as-is (e.g. `local`). */
export const shortCommit = (commit: string): string => (/^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 12) : commit);

/** A link into the private source repository at the built commit, labelled as requiring repository access. */
export function repoLink(commit: string, file: string, text: string = file, line?: number): string {
  const ref = /^[0-9a-f]{40}$/.test(commit) ? commit : 'main';
  const anchor = line && Number.isInteger(line) && line > 0 ? `#L${line}` : '';
  const url = `${SOURCE_REPO_URL}/blob/${ref}/${file.split('/').map(encodeURIComponent).join('/')}${anchor}`;
  return `<a class="repo" href="${esc(url)}">${esc(text)}</a> <span class="access">(${ACCESS_LABEL})</span>`;
}

// ---------------------------------------------------------------------------------------------------------------- numbers

/** Percent with precision that never rounds a non-zero share to 0 % or a non-certain share to 100 %. Returns HTML-safe text. */
export function pct(p: number): string {
  if (!Number.isFinite(p)) throw new Error(`Non-finite probability ${p}`);
  if (p === 0) return '0%';
  if (p === 1) return '100%';
  const v = p * 100;
  if (v < 0.01) return '&lt;0.01%';
  if (v > 99.99) return '&gt;99.99%';
  const digits = v < 1 || v > 99 ? 2 : 1;
  return `${v.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}%`;
}

/** Plain number: integers as-is, otherwise up to 3 decimals (trailing zeros trimmed); a non-zero value never shows as 0. HTML-safe. */
export function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite number ${n}`);
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs < 0.001) return n > 0 ? '&lt;0.001' : '&gt;-0.001';
  const s = abs >= 100 ? n.toFixed(1) : abs >= 1 ? n.toFixed(2) : n.toFixed(3);
  return s.replace(/\.?0+$/, '');
}

/** Integer range `lo–hi` (or a single value). */
export const range = (lo: number, hi: number): string => (lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`);

/** A lightweight horizontal share bar (decorative: the exact number is always printed next to it). */
export function bar(share: number): string {
  if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error(`Bar share out of range: ${share}`);
  const width = share === 0 ? 0 : Math.max(0.5, Math.round(share * 10000) / 100);
  return `<span class="bar" aria-hidden="true"><span class="bar-fill" style="width:${width}%"></span></span>`;
}

/** A neutral group/category chip. Identity is always the text, never colour alone. */
export const chip = (label: string, kind = 'group'): string => `<span class="chip chip-${slug(kind)}">${esc(label)}</span>`;

export type BadgeTone = 'guaranteed' | 'conditional' | 'special' | 'decoration' | 'nonloot' | 'notderivable' | 'exact' | 'info';
/** A short status label. Tone only styles it; the text carries the meaning. */
export const badge = (label: string, tone: BadgeTone = 'info'): string => `<span class="badge badge-${tone}">${esc(label)}</span>`;

// ------------------------------------------------------------------------------------------------------------- page shell

export interface SiteContext {
  /** Full commit SHA, or `local` when built outside Git. */
  commit: string;
  /** Short digest of data/loot.json — identifies the exact generated loot data. */
  dataDigest: string;
  /** Short digest of data/enemies.json — identifies the exact generated enemy spawn data (task enemy-spawn-tables-20261030). */
  enemyDigest: string;
  /** Game title (from the data's build info). */
  gameTitle: string;
}

export interface Crumb {
  label: string;
  path?: string;
}

export type Section = 'home' | 'loot' | 'enemies' | 'read' | 'playtest';

export interface PageSpec {
  /** Site path of this page, e.g. `loot/office/index.html`. */
  path: string;
  title: string;
  description: string;
  section: Section;
  crumbs?: Crumb[];
  /** Inner HTML of <main> (after the H1, which the shell renders from `heading` or `title`). */
  body: string;
  heading?: string;
  lede?: string;
}

/** The site navigation shown on every page (tools/pages/validate.ts checks that every page links to each entry). */
export const NAV: ReadonlyArray<{section: Section; label: string; path: string}> = [
  {section: 'home', label: 'Home', path: 'index.html'},
  {section: 'loot', label: 'Loot tables', path: 'loot/index.html'},
  {section: 'enemies', label: 'Enemy spawns', path: 'enemies/index.html'},
  {section: 'read', label: 'How to read loot numbers', path: 'loot/how-to-read.html'},
  {section: 'playtest', label: 'Playtest', path: 'playtest.html'},
];

export function renderPage(ctx: SiteContext, spec: PageSpec): string {
  const p = spec.path;
  const nav = NAV.map(n => {
    const current = n.section === spec.section ? (n.path === p ? ' aria-current="page"' : ' aria-current="true"') : '';
    return `<li><a href="${esc(href(p, n.path))}"${current}>${esc(n.label)}</a></li>`;
  }).join('');
  const crumbs = spec.crumbs?.length
    ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${spec.crumbs
      .map((c, i, all) => (i === all.length - 1 || !c.path
        ? `<li><span aria-current="${i === all.length - 1 ? 'page' : 'false'}">${esc(c.label)}</span></li>`
        : `<li><a href="${esc(href(p, c.path))}">${esc(c.label)}</a></li>`))
      .join('')}</ol></nav>`
    : '';
  const commitText = shortCommit(ctx.commit);
  const commitHtml = /^[0-9a-f]{40}$/.test(ctx.commit)
    ? `<a class="repo" href="${esc(`${SOURCE_REPO_URL}/commit/${ctx.commit}`)}"><code>${esc(commitText)}</code></a> <span class="access">(${ACCESS_LABEL})</span>`
    : `<code>${esc(commitText)}</code> (built outside a Git checkout)`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(spec.description)}">
<meta name="generator" content="Terminal State reference generator (tools/pages)">
<meta name="color-scheme" content="light dark">
<title>${esc(spec.title)} · ${esc(ctx.gameTitle)} reference</title>
<link rel="icon" href="${esc(href(p, 'assets/favicon.svg'))}" type="image/svg+xml">
<link rel="stylesheet" href="${esc(href(p, 'assets/site.css'))}">
<script src="${esc(href(p, 'assets/site.js'))}" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap header-inner">
<a class="brand" href="${esc(href(p, 'index.html'))}"><span class="brand-mark" aria-hidden="true">TS</span><span class="brand-text">${esc(ctx.gameTitle)}<span class="brand-sub">Game reference</span></span></a>
<nav class="site-nav" aria-label="Site"><ul>${nav}</ul></nav>
</div>
</header>
<main id="main" class="wrap" tabindex="-1">
${crumbs}
<h1>${esc(spec.heading ?? spec.title)}</h1>
${spec.lede ? `<p class="lede">${spec.lede}</p>` : ''}
${spec.body}
</main>
<footer class="site-footer">
<div class="wrap">
<p class="build-id">Generated from the game source at commit ${commitHtml} · loot data digest <code>${esc(ctx.dataDigest)}</code> (<a href="${esc(href(p, 'data/loot.json'))}">data/loot.json</a>) · enemy spawn data digest <code>${esc(ctx.enemyDigest)}</code> (<a href="${esc(href(p, 'data/enemies.json'))}">data/enemies.json</a>)</p>
<p>Every value on this site is generated from the current game source when the site is built; nothing is hand-copied. The game source repository is private. ${esc(ctx.gameTitle)} is an early prototype; numbers change as the game is tuned.</p>
</div>
</footer>
</body>
</html>
`;
}

/** A data table wrapped in a keyboard-scrollable region. `head` cells become <th scope="col">. */
export function table(opts: {
  caption: string;
  head: string[];
  rows: string[][];
  id?: string;
  /** Per-row extra attributes (e.g. data-search for the filter script). */
  rowAttrs?: string[];
  /** Index of a column whose cells are row headers (<th scope="row">). */
  rowHeader?: number;
  className?: string;
  numeric?: number[];
}): string {
  const numeric = new Set(opts.numeric ?? []);
  const cls = (i: number) => (numeric.has(i) ? ' class="num"' : '');
  const head = opts.head.map((h, i) => `<th scope="col"${cls(i)}>${h}</th>`).join('');
  const body = opts.rows
    .map((r, ri) => `<tr${opts.rowAttrs?.[ri] ? ` ${opts.rowAttrs[ri]}` : ''}>${r
      .map((c, i) => (i === opts.rowHeader ? `<th scope="row"${cls(i)}>${c}</th>` : `<td${cls(i)}>${c}</td>`))
      .join('')}</tr>`)
    .join('\n');
  const idAttr = opts.id ? ` id="${esc(opts.id)}"` : '';
  return `<div class="table-wrap" role="region" aria-label="${esc(opts.caption)}" tabindex="0">
<table class="data${opts.className ? ` ${esc(opts.className)}` : ''}"${idAttr}>
<caption>${esc(opts.caption)}</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>`;
}

/** A filter box for the client script (hidden until the script enables it; everything stays visible without JS). */
export function filterBox(targetId: string, label: string, noun = 'rows', placeholder = 'Type an item name or id'): string {
  const id = `filter-${slug(targetId)}`;
  return `<div class="filter" data-filter="${esc(targetId)}" data-filter-noun="${esc(noun)}" hidden>
<label for="${esc(id)}">${esc(label)}</label>
<input id="${esc(id)}" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}">
<span class="filter-status" data-filter-status aria-live="polite"></span>
</div>`;
}

/** Search text for the filter script: lowercase, deduplicated words. */
export function searchAttr(...parts: Array<string | undefined>): string {
  const words = [...new Set(parts.filter((x): x is string => !!x).join(' ').toLowerCase().split(/\s+/).filter(Boolean))];
  return `data-filter-row data-search="${esc(words.join(' '))}"`;
}
