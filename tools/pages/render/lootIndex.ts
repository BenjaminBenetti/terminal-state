// Task loot-reference-pages-20261030 (lane SITE): loot explorer home (levels index) and "How to read the numbers".
import type {SourceClass} from '../lootReferenceTypes';
import {esc, href, renderPage, repoLink, slug, table} from './html';
import {classBadge, KNOB_DESCRIPTIONS, prose, type Site} from './common';

export function renderLootIndex(site: Site): string {
  const p = 'loot/index.html';
  const {ref} = site;
  const levelCards = ref.levels.map(level => {
    const dir = site.levelDir.get(level.id)!;
    const usedSlots = level.slots.filter(s => s.contexts.length > 0);
    const overrides = level.profile.overrides.length
      ? `${level.profile.overrides.length} override${level.profile.overrides.length === 1 ? '' : 's'}`
      : 'no overrides (source values)';
    return `<li class="card">
<h3><a href="${esc(href(p, `${dir}/index.html`))}">${esc(level.label)}</a></h3>
<p>${prose(level.blurb)}</p>
<p class="stat">Profile <code>${esc(level.profile.id)}</code> · ${esc(overrides)}</p>
<p class="stat">${level.holders.length} holder contexts in ${usedSlots.length} of ${level.slots.length} slot categories · ${level.specials.length} special sources</p>
<p><a href="${esc(href(p, `${dir}/index.html#slots`))}">Surfaces &amp; containers</a> · <a href="${esc(href(p, `${dir}/floor.html`))}">Floor finds</a> · <a href="${esc(href(p, `${dir}/economy.html`))}">Scarcity &amp; economy</a></p>
</li>`;
  }).join('\n');

  const census = ref.meta.census.length
    ? table({
      caption: 'Sample census used for “observed in N sample levels” labels',
      head: ['Level', 'Sample seeds', 'Start weapon', 'Loot holders seen', 'Distinct contexts', 'Note'],
      numeric: [2, 3, 4],
      rows: ref.meta.census.map(c => [
        esc(ref.levels.find(l => l.id === c.level)?.label ?? c.level),
        esc(c.seeds.join(', ')),
        esc(c.startWeapon),
        String(c.holders),
        String(c.contexts),
        prose(c.note),
      ]),
    })
    : '';

  const body = `
<div class="callout">
<p><strong>Read this first.</strong> A row's <em>weight</em> is relative, not a chance. A <em>share</em> is a conditional selection chance
given that one lot is drawn from that table, and it is always shown with its denominator. Several stage gates sit between a table row and an
item in the world, and the last of them (whether the item physically fits) cannot be derived from the tables.
<a href="${esc(href(p, 'loot/how-to-read.html'))}">How to read the numbers</a>.</p>
</div>

<h2 id="levels">Levels</h2>
<ul class="cards">
${levelCards}
</ul>

<h2 id="browse">Browse across levels</h2>
<ul class="cards">
<li class="card"><h3><a href="${esc(href(p, 'loot/tables/index.html'))}">All tables</a></h3><p>${Object.keys(ref.tables).length} distinct tables. A table shared by several holders or rooms is listed once, with everything that uses it.</p></li>
<li class="card"><h3><a href="${esc(href(p, 'loot/items/index.html'))}">Items</a></h3><p>${Object.keys(ref.items).length} items with human names and stable ids. Each item shows every table and source that can produce it.</p></li>
<li class="card"><h3><a href="${esc(href(p, 'loot/holders.html'))}">Slot categories &amp; holder kinds</a></h3><p>The ${ref.slots.length} slot categories (${ref.slots.map(s => esc(s.label)).join(', ')}) and the holder kinds that plug into them.</p></li>
<li class="card"><h3><a href="${esc(href(p, 'loot/sources.html'))}">Special sources</a></h3><p>${ref.specials.length} sources outside the holder tables: rare gear, gas masks and filters, weapons and paired ammo, the starter kit, the roof cache, fixtures and interaction rules.</p></li>
</ul>

<h2 id="freshness">Freshness and data</h2>
<p>This explorer is regenerated from the game source on every change to the main branch. The page footer shows the source commit
and the data digest. The complete generated data is available as <a href="${esc(href(p, 'data/loot.json'))}">data/loot.json</a>.</p>
${census}
<details class="group">
<summary>Game source files the values are read from (${ref.meta.generatedFrom.length})</summary>
<div class="group-body"><ul>${ref.meta.generatedFrom.map(f => `<li>${repoLink(site.ctx.commit, f)}</li>`).join('')}</ul>
<p class="note">${prose(ref.meta.repo.note)}</p></div>
</details>`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: 'Loot tables',
    description: `${site.ctx.gameTitle} loot tables per level, generated from the game source.`,
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables'}],
    lede: 'Choose a level to see where loot comes from: every surface and container category, the tables they draw from, the loose '
      + 'floor finds and the special sources, with each stage gate between a table row and an item in the world.',
    body,
  });
}

const CLASS_TEXT: Record<SourceClass, string> = {
  guaranteed: 'Always yields its stated contents (the starter kit, the roof cache picks). Fit can still matter where noted.',
  conditional: 'Table-driven and gated by chances: empty chance, lot count, per-lot pick, scarcity, fit. Most holders and floor finds.',
  special: 'An explicit rule outside the holder tables, such as rare gear or weapon finds with their paired ammo.',
  'non-loot': 'Rolls nothing new. Fixed fixture contents, or rules that only move or release existing finite lots (pry, spill, detach).',
  'decoration-only': 'Looks like stock but is not an item you can take (for example shelf filler).',
};

export function renderHowToRead(site: Site): string {
  const p = 'loot/how-to-read.html';
  const {ref} = site;
  const notes = ref.probability.map(n => `<section id="${esc(`def-${slug(n.id)}`)}">
<h2>${esc(n.title)}</h2>
${n.text.split(/\n{2,}/).map(par => `<p>${prose(par.trim())}</p>`).join('\n')}
</section>`).join('\n');
  const toc = ref.probability.map(n => `<li><a href="#${esc(`def-${slug(n.id)}`)}">${esc(n.title)}</a></li>`).join('');
  // Task enemy-spawn-tables-20261030 (lane SITE): pointer to the enemy section's own definitions page.
  const body = `
<p class="note">This page covers loot. For enemy spawn counts, family shares and room modifiers, see
<a href="${esc(href(p, 'enemies/how-to-read.html'))}">How to read enemy numbers</a>.</p>
<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">On this page</h2><ul>
<li><a href="#pipeline">From table row to item</a></li>${toc}<li><a href="#labels">Source labels</a></li><li><a href="#override-knobs">Override knobs</a></li><li><a href="#not-stated">What is never stated</a></li>
</ul></nav>

<section id="pipeline">
<h2>From table row to item in the world</h2>
<p>Every loot holder (a desk top, a cabinet, a toilet stall) resolves to one table in its level and room, then passes these stages
once, when its contents are first rolled. The level pages show each stage for each holder context.</p>
<ol class="stages">
<li><strong>Empty?</strong> The holder is empty with its empty chance. P(not empty) = 1 − empty. <span class="badge badge-exact">exact</span></li>
<li><strong>How many lots.</strong> A lot count n is drawn uniformly from the lot range, so E[n] = (lo + hi) / 2. <span class="badge badge-exact">exact</span></li>
<li><strong>Which item per lot.</strong> Each lot picks one row of the table with probability weight / Σ weights: the conditional share. Plain rooms first pick a category, then an item. <span class="badge badge-conditional">conditional</span></li>
<li><strong>Stack size.</strong> Ammo boxes and handfuls get their round counts from the box and handful ranges.</li>
<li><strong>Scarcity.</strong> Ammo is kept exactly as rolled. Every other find survives with the theme's keep chance and may be re-themed to an on-theme or off-theme category, limited by what the holder may hold. <span class="badge badge-conditional">conditional</span></li>
<li><strong>Limb treatments.</strong> A share of healing finds become limb treatments.</li>
<li><strong>Fit.</strong> Each item must fit on a real surface of the holder. An item that fits nowhere is dropped. <span class="badge badge-notderivable">not derivable</span></li>
<li><strong>Finite and persistent.</strong> Contents are rolled once, remembered, and never refilled or re-rolled.</li>
</ol>
<p>The “expected units” and “chance of at least one” figures on this site are exact for stages 1–6 under the game's own numbers.
They are measured <strong>before fit</strong>, so they are upper bounds on what is actually placed.</p>
</section>

${notes}

<section id="labels">
<h2>Source labels</h2>
${table({
    caption: 'How each loot source is labelled',
    head: ['Label', 'Meaning'],
    rows: (Object.keys(CLASS_TEXT) as SourceClass[]).map(c => [classBadge(c), esc(CLASS_TEXT[c])]),
  })}
</section>

<section id="override-knobs">
<h2>Override knobs</h2>
<p>Each value on this site names the source file and export where it lives, so feedback can point at the exact knob. A level's
<em>profile</em> can also scale values without editing the shared tables, through these override knobs:</p>
${table({
    caption: 'Per-level override knobs (LootOverrides in the level profile)',
    head: ['Knob', 'What it changes'],
    rows: Object.entries(KNOB_DESCRIPTIONS).map(([k, v]) => [`<code>${esc(k)}</code>`, esc(v)]),
  })}
<p>Lowering a row's weight moves draws to the other rows of the same table. Lowering a keep chance removes finds without moving them
anywhere. Lowering an empty chance or raising a lot range adds finds to every holder of that kind.</p>
</section>

<section id="not-stated">
<h2>What this site never states, and why</h2>
<ul>
<li><strong>No “chance to find X in a level”</strong> for holder loot or floor finds. How many holders of each kind a level contains is
decided by the level generator for each seed; the tables cannot tell how many desks or fridges a station or tower will have. The only
per-level figures are for the level-wide rolls (rare gear, gas masks and filters), which happen once per level and are exact before
placement.</li>
<li><strong>No final chance that a specific container holds an item after placement.</strong> Fit and occupancy depend on the item's size
and the holder's real surfaces and are decided in the world, so the site labels that stage “not derivable”.</li>
<li><strong>“Observed in N sample levels”</strong> comes from a small fixed set of generated sample levels. It shows that a context
occurs, not how often. It is not exhaustive.</li>
</ul>
</section>`;
  return renderPage(site.ctx, {
    path: p,
    section: 'read',
    title: 'How to read the numbers',
    description: 'Probability definitions used by the loot explorer: weights, conditional shares, stage gates and what is not derivable.',
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'How to read the numbers'}],
    lede: `Weights, conditional shares, stage gates and expected counts before fit: what each number on the ${esc(site.ctx.gameTitle)} loot pages means.`,
    body,
  });
}
