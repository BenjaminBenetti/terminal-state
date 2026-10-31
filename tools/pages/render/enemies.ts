// Task enemy-spawn-tables-20261030 (lane SITE): the "Enemy spawns" section of the reference site, rendered ONLY from the
// EnemyReference object (contract tools/pages/enemyReferenceTypes.ts, built by lane SPAWN's buildEnemyReference from the real spawn
// profile API). It never imports game modules and holds no numbers of its own: every count, weight, share, cap, distance and modifier
// on these pages comes from the object. The prose here only explains what the numbers mean.
//
// Routes (flat; the allowlist in tools/pages/validate.ts accepts enemies/<page>.html only):
//   enemies/index.html         levels overview: contexts and count ranges, spawns tried per level, family mix, room modifiers
//   enemies/<level>.html       one level's spawn profile (tools/pages/render/enemyLevel.ts)
//   enemies/families.html      every registered enemy family and its weight / conditional share per level
//   enemies/how-to-read.html   units, vocabulary, room-modifier semantics and what the pages never state
//   data/enemies.json          the EnemyReference object itself
//
// Coverage: every level, generation context, family and room key gets a stable anchor (ctx-*, family-*, room-*) that
// tools/pages/validate.ts checks against data/enemies.json. An unknown key kind / modifier field, or a reference to a family or
// context the object does not register, throws here so the build fails instead of silently dropping it.
import {ENEMY_REFERENCE_SCHEMA, type EnemyFamilyInfo, type EnemyLevelInfo, type EnemyReference, type RoomRow, type SourceLoc} from '../enemyReferenceTypes';
import {badge, esc, href, num, pct, range, renderPage, repoLink, slug, table, type Crumb, type SiteContext} from './html';
import {prose, shareCell} from './common';

/**
 * The reserved room-modifier family key of the contract ("The reserved family key 'all'", enemyReferenceTypes.ts
 * ModifierSemantics.allFamilies). makeEnemySite checks that the published semantics still name it, so a rename fails the build.
 */
export const ALL_FAMILIES_KEY = 'all';

/** Page names inside enemies/ that a level slug may never take. */
export const RESERVED_ENEMY_PAGES = ['index', 'how-to-read', 'families'] as const;

/** The family the contract's `zombieTypes` (shambler / coated) split: a sub-distribution of this family, not families of their own. */
export const ZOMBIE_FAMILY = 'zombie';

export const ENEMIES_INDEX = 'enemies/index.html';
export const ENEMIES_FAMILIES = 'enemies/families.html';
export const ENEMIES_HOW_TO = 'enemies/how-to-read.html';

/** Site path of a level's spawn profile page (validate.ts uses the same convention for its coverage check). */
export const enemyLevelPage = (levelId: string): string => `enemies/${slug(levelId)}.html`;
export const ctxAnchor = (contextId: string): string => `ctx-${slug(contextId)}`;
export const familyAnchor = (familyId: string): string => `family-${slug(familyId)}`;
export const roomAnchor = (roomKey: string): string => `room-${slug(roomKey)}`;
export const termAnchor = (term: string): string => `term-${slug(term)}`;
/** Task track3-eaton-centre-20261031 (lane PROFILES): anchors of a level's family hooks and rare-placement rules. */
export const hookAnchor = (family: string): string => `hook-${slug(family)}`;
export const rareAnchor = (family: string): string => `rare-${slug(family)}`;

export interface EnemySite {
  ref: EnemyReference;
  ctx: SiteContext;
  families: Map<string, EnemyFamilyInfo>;
  levels: Map<string, EnemyLevelInfo>;
}

/** Labels for every room-key kind the contract defines. A new kind must be labelled here (the build throws otherwise). */
export const KEY_KIND_LABEL: Record<RoomRow['keyKind'], string> = {
  purpose: 'Room purpose',
  'room-type': 'Room type',
};

/** Labels for every room-modifier field the contract defines. */
export const MODIFIER_FIELD_LABEL: Record<'density' | 'weight', string> = {
  density: 'Density (local intensity)',
  weight: 'Weight (conditional composition)',
};

export function keyKindLabel(kind: string): string {
  const label = (KEY_KIND_LABEL as Record<string, string>)[kind];
  if (!label) throw new Error(`Unlabelled room key kind ${kind} (add it to KEY_KIND_LABEL in tools/pages/render/enemies.ts)`);
  return label;
}

export function modifierFieldLabel(field: string): string {
  const label = (MODIFIER_FIELD_LABEL as Record<string, string>)[field];
  if (!label) throw new Error(`Unlabelled room modifier field ${field} (add it to MODIFIER_FIELD_LABEL in tools/pages/render/enemies.ts)`);
  return label;
}

function assertUniqueSlugs(what: string, ids: readonly string[], reserved: readonly string[] = []): void {
  const seen = new Map<string, string>(reserved.map(r => [r, `reserved page ${r}`]));
  for (const id of ids) {
    const s = slug(id);
    const prior = seen.get(s);
    if (prior !== undefined) throw new Error(`${what} ${JSON.stringify(id)} slugs to "${s}", which collides with ${prior}`);
    seen.set(s, JSON.stringify(id));
  }
}

/**
 * Index the reference and check its internal consistency. Everything a page names (families in pools / rooms / censuses,
 * contexts in the zombie-type and census tables) must be registered in the object, and every id must have a unique anchor.
 */
export function makeEnemySite(ref: EnemyReference, ctx: SiteContext): EnemySite {
  if (ref.meta.schema !== ENEMY_REFERENCE_SCHEMA) throw new Error(`EnemyReference schema ${ref.meta.schema}, renderer expects ${ENEMY_REFERENCE_SCHEMA}`);
  if (!ref.levels.length) throw new Error('EnemyReference has no levels');
  if (!ref.families.length) throw new Error('EnemyReference has no enemy families');
  assertUniqueSlugs('Level', ref.levels.map(l => l.id), RESERVED_ENEMY_PAGES);
  assertUniqueSlugs('Family', ref.families.map(f => f.id));
  assertUniqueSlugs('Vocabulary term', ref.vocabulary.map(v => v.term));
  const families = new Map(ref.families.map(f => [f.id, f]));
  const levels = new Map(ref.levels.map(l => [l.id, l]));
  const family = (id: string, where: string) => {
    if (!families.has(id)) throw new Error(`${where} names enemy family ${JSON.stringify(id)}, which is not in the family registry of the reference`);
  };
  for (const f of ref.families) for (const l of f.levels) if (!levels.has(l)) throw new Error(`Family ${f.id} lists unknown level ${l}`);
  if (ref.levels.some(l => l.zombieTypes.types.length)) family(ZOMBIE_FAMILY, 'The zombie type split (ZOMBIE_FAMILY)');
  for (const m of ref.modifiers.fields) modifierFieldLabel(m.field);
  if (!ref.modifiers.allFamilies.includes(`'${ALL_FAMILIES_KEY}'`)) {
    throw new Error(`Room modifier semantics no longer name the reserved family key '${ALL_FAMILIES_KEY}' (update ALL_FAMILIES_KEY in tools/pages/render/enemies.ts)`);
  }
  for (const level of ref.levels) {
    const at = `Level ${level.id}`;
    if (!level.contexts.length) throw new Error(`${at} has no generation contexts`);
    assertUniqueSlugs(`${at} context`, level.contexts.map(c => c.id));
    assertUniqueSlugs(`${at} room key`, level.rooms.rows.map(r => r.room));
    const contexts = new Set(level.contexts.map(c => c.id));
    const context = (id: string, where: string) => {
      if (!contexts.has(id)) throw new Error(`${at} ${where} names context ${JSON.stringify(id)}, which the level does not list`);
    };
    for (const r of level.pool.rows) family(r.family, `${at} family pool`);
    for (const r of level.pool.expectedPerLevel) family(r.family, `${at} expected per level`);
    for (const e of level.rooms.entries) if (e.family !== ALL_FAMILIES_KEY) family(e.family, `${at} room entry ${e.room}`);
    for (const row of level.rooms.rows) {
      keyKindLabel(row.keyKind);
      for (const f of row.families) family(f.family, `${at} room ${row.room}`);
      for (const f of Object.keys(row.observed?.placed ?? {})) family(f, `${at} room ${row.room} census`);
    }
    for (const c of level.zombieTypes.expectedCoated) context(c.context, 'zombie type table');
    if (level.census) {
      for (const p of level.census.placed) family(p.family, `${at} census`);
      for (const c of level.census.byContext) context(c.context, 'census');
      for (const k of level.census.byAreaKind) for (const f of Object.keys(k.placed)) family(f, `${at} census area kind ${k.kind}`);
    }
  }
  return {ref, ctx, families, levels};
}

// ------------------------------------------------------------------------------------------------------------- fragments

/** `<code>symbol</code> in file:line (repository access required)`. */
export function enemySourceLoc(es: EnemySite, at: SourceLoc): string {
  return `<code>${esc(at.symbol)}</code> in ${repoLink(es.ctx.commit, at.file, at.file + (at.line ? `:${at.line}` : ''), at.line)}`;
}

/** A modifier value as a multiplier, e.g. `1×`. HTML-safe. */
export const mult = (n: number): string => `${num(n)}×`;

/** Uniform count range as the generator draws it. */
export const uniform = (lo: number, hi: number): string => `U{${num(lo)}..${num(hi)}}`;

export function familyLabel(es: EnemySite, id: string): string {
  return es.families.get(id)?.label ?? id;
}

/** Human label with the stable id underneath (the id alone when they are equal). */
export function labelWithId(label: string, id: string): string {
  return label === id ? `<code>${esc(id)}</code>` : `${esc(label)}<span class="item-id">${esc(id)}</span>`;
}

/** Family name linked to its entry on the families page, with the registry id underneath. */
export function familyCell(es: EnemySite, page: string, id: string): string {
  return `<a href="${esc(href(page, `${ENEMIES_FAMILIES}#${familyAnchor(id)}`))}">${esc(familyLabel(es, id))}</a><span class="item-id">${esc(id)}</span>`;
}

export function enemyCrumbs(last?: Crumb[]): Crumb[] {
  return [{label: 'Home', path: 'index.html'}, ...(last?.length ? [{label: 'Enemy spawns', path: ENEMIES_INDEX}, ...last] : [{label: 'Enemy spawns'}])];
}

/** True when every resolved room modifier of the level is exactly 1 (the shipped state). */
export function allNeutral(es: EnemySite, level: EnemyLevelInfo): boolean {
  const n = es.ref.modifiers.neutral;
  return level.rooms.rows.every(r => r.intensity === n && r.families.every(f => f.density === n && f.weight === n));
}

/** One-line modifier status for a level. */
export function modifierStatus(es: EnemySite, level: EnemyLevelInfo): string {
  const rows = level.rooms.rows.length;
  if (allNeutral(es, level)) {
    return `All ${rows} room key${rows === 1 ? '' : 's'} resolve to ${mult(es.ref.modifiers.neutral)} for every family (neutral)`
      + `${level.rooms.entries.length ? '' : '; the profile sets no room modifiers'}`;
  }
  const off = level.rooms.rows.filter(r => r.intensity !== es.ref.modifiers.neutral
    || r.families.some(f => f.density !== es.ref.modifiers.neutral || f.weight !== es.ref.modifiers.neutral)).length;
  return `${off} of ${rows} room keys have a non-neutral modifier`;
}

/** Family shares of a level as compact text ("Infected 95% · …"). */
function familyMix(es: EnemySite, level: EnemyLevelInfo): string {
  return level.pool.rows.map(r => `${esc(familyLabel(es, r.family))} ${pct(r.share)}`).join(' · ');
}

/** The "three kinds of number" explanation, shared by the index and the how-to-read page. */
/** Zombie type names across all levels, in first-seen order ("shambler, coated"). */
export function zombieTypeNames(es: EnemySite): string {
  return [...new Set(es.ref.levels.flatMap(l => l.zombieTypes.types.map(t => t.type)))].map(t => esc(t)).join(', ');
}

function threeNumbers(es: EnemySite, page: string, link = true): string {
  return `<ol class="stages">
<li><strong>Intensity: how many spawns a context tries to place.</strong> Each generation context draws one whole number, uniformly
from its count range, every time it runs. E[count] = (lo + hi) / 2 exactly. This is the only “how many” rule the game has: there is
no per-area or per-square-metre spawn rate. ${badge('exact', 'exact')}</li>
<li><strong>Conditional type share: what one placed spawn is.</strong> Given that a spawn is placed, the chance it is a given enemy
family is that family's weight divided by the sum of the weights (the denominator is always shown). Zombie types (${zombieTypeNames(es)})
are a further split of the ${esc(familyLabel(es, ZOMBIE_FAMILY))} family only. ${badge('conditional', 'conditional')}</li>
<li><strong>Placed and observed counts: what a generated level actually holds.</strong> The generator can place fewer spawns than
it drew when eligible floor, spacing, per-area caps or tries run out. Observed counts and densities on these pages come from a small
labelled sample of generated levels, never from the runtime rules. ${badge('sampled', 'info')}</li>
</ol>
${link ? `<p class="note">Details: <a href="${esc(href(page, ENEMIES_HOW_TO))}">How to read enemy numbers</a>.</p>` : ''}`;
}

// ------------------------------------------------------------------------------------------------------------- index

export function renderEnemiesIndex(es: EnemySite): string {
  const p = ENEMIES_INDEX;
  const {ref} = es;
  const cards = ref.levels.map(level => {
    const contexts = level.contexts.map(c => `${esc(c.label)} ${range(c.count.lo, c.count.hi)}${c.runs !== 1 ? ` × ${num(c.runs)} runs` : ''}`).join(' · ');
    return `<li class="card">
<h3><a href="${esc(href(p, enemyLevelPage(level.id)))}">${esc(level.name)}</a></h3>
<p>${prose(level.blurb)}</p>
<p class="stat">Contexts (count per run): ${contexts}</p>
<p class="stat">Spawns tried per level: ${range(level.total.lo, level.total.hi)} (E = ${num(level.total.mean)})</p>
<p class="stat">Family mix (conditional): ${familyMix(es, level)}</p>
<p class="stat">Room modifiers: ${modifierStatus(es, level)}.</p>
</li>`;
  }).join('\n');

  const levelSummary = table({
    caption: 'Generation contexts per level (count per run, drawn uniformly; contexts are parts of one logical level)',
    head: ['Level', 'Context', 'Storeys one run covers', 'Runs per level', 'Count per run', 'E[count] per run', 'Per level'],
    numeric: [3, 5],
    rows: ref.levels.flatMap(level => level.contexts.map(c => [
      `<a href="${esc(href(p, enemyLevelPage(level.id)))}">${esc(level.name)}</a>`,
      `<a href="${esc(href(p, `${enemyLevelPage(level.id)}#${ctxAnchor(c.id)}`))}">${esc(c.label)}</a><span class="item-id">${esc(c.id)}</span>`,
      prose(c.storeys),
      num(c.runs),
      `${range(c.count.lo, c.count.hi)} <span class="denom">${esc(uniform(c.count.lo, c.count.hi))}</span>`,
      num(c.count.mean),
      `${range(c.perLevel.lo, c.perLevel.hi)} <span class="denom">E = ${num(c.perLevel.mean)}</span>`,
    ])),
  });

  const mixHead = ['Family', ...ref.levels.map(l => esc(l.name))];
  const mix = table({
    caption: 'Family mix by level: conditional share of one placed spawn (weight / Σ weights of that level\'s pool)',
    head: mixHead,
    rowHeader: 0,
    rows: ref.families.map(f => [
      familyCell(es, p, f.id),
      ...ref.levels.map(level => {
        const row = level.pool.rows.find(r => r.family === f.id);
        return row ? shareCell(row.share, row.weight, level.pool.denominator) : '<span class="muted">not in this level\'s pool</span>';
      }),
    ]),
    className: 'rows',
  });

  const census = ref.meta.census.length
    ? table({
      caption: 'Sample corpus of the sampled (observed) enemy figures',
      head: ['Level', 'Sample seeds', 'Start weapon', 'Note'],
      rows: ref.meta.census.map(c => [esc(es.levels.get(c.level)?.name ?? c.level), esc(c.seeds.join(', ')), esc(c.startWeapon), prose(c.note)]),
    })
    : '<p>This build contains no sampled census: every number on these pages is a source value or exact derivation.</p>';

  const body = `
<div class="callout">
<p><strong>Read this first.</strong> Enemies are placed as a <em>count per generation context</em>, spread over eligible floor by
the generator's own placement rules. A family's <em>share</em> is the conditional chance that one placed spawn is that family, shown
with its denominator; it is not a chance per room or per square metre.</p>
</div>
${threeNumbers(es, p)}

<h2 id="levels">Levels</h2>
<p>Every logical level registered in the game. A new level appears here automatically when it has a spawn profile.</p>
<ul class="cards">
${cards}
</ul>
${levelSummary}

<h2 id="families">Enemy families</h2>
<p>Each registered enemy family and its share in each level's pool. Different levels can mix families differently; a family a
level's pool does not list never spawns there. <a href="${esc(href(p, ENEMIES_FAMILIES))}">All families</a>.</p>
${mix}

<h2 id="freshness">Freshness and data</h2>
<p>This section is regenerated from the game source on every change to the main branch. The page footer shows the source commit
and the enemy spawn data digest. The complete generated data is available as <a href="${esc(href(p, 'data/enemies.json'))}">data/enemies.json</a>.</p>
${census}
<details class="group">
<summary>Game source files the values are read from (${ref.meta.generatedFrom.length})</summary>
<div class="group-body"><ul>${ref.meta.generatedFrom.map(f => `<li>${repoLink(es.ctx.commit, f)}</li>`).join('')}</ul>
<p class="note">${prose(ref.meta.repo.note)}</p></div>
</details>`;
  return renderPage(es.ctx, {
    path: p,
    section: 'enemies',
    title: 'Enemy spawns',
    description: `${es.ctx.gameTitle} enemy spawn profiles per level, generated from the game source.`,
    crumbs: enemyCrumbs(),
    lede: 'Choose a level to see how many enemies each part of it tries to place, which enemy families they can be, where the '
      + 'generator puts them and which room modifiers apply.',
    body,
  });
}

// ------------------------------------------------------------------------------------------------------------- families

export function renderEnemyFamilies(es: EnemySite): string {
  const p = ENEMIES_FAMILIES;
  const {ref} = es;
  const sections = ref.families.map(f => {
    const rows = ref.levels.map(level => {
      const row = level.pool.rows.find(r => r.family === f.id);
      const expected = level.pool.expectedPerLevel.find(e => e.family === f.id);
      const link = `<a href="${esc(href(p, `${enemyLevelPage(level.id)}#${familyAnchor(f.id)}`))}">${esc(level.name)}</a>`;
      return row
        ? [link, num(row.weight), shareCell(row.share, row.weight, level.pool.denominator), expected ? num(expected.mean) : '<span class="muted">not stated</span>']
        : [link, '<span class="muted">not in pool</span>', '<span class="muted">never spawns here</span>', '0'];
    });
    const levels = f.levels.length
      ? f.levels.map(id => esc(es.levels.get(id)?.name ?? id)).join(', ')
      : 'none';
    return `<section id="${esc(familyAnchor(f.id))}">
<h2>${esc(f.label)}</h2>
<dl class="facts">
<dt>Registry id</dt><dd><code>${esc(f.id)}</code></dd>
<dt>Model</dt><dd>${f.model ? `<code>${esc(f.model)}</code>` : 'The zombie wardrobe (outfits chosen when the enemy spawns)'}</dd>
<dt>Spawns in</dt><dd>${levels}${f.levels.length ? '' : ` ${badge('no registered level spawns it', 'info')}`}</dd>
<dt>Variants inside the family</dt><dd>${f.variants ? prose(f.variants) : 'None'}</dd>
<dt>Defined at</dt><dd>${enemySourceLoc(es, f.at)}</dd>
</dl>
${table({
      caption: `${f.label}: weight and conditional share per level (expected per level = share × spawns tried per level, before any placement shortfall)`,
      head: ['Level', 'Weight', 'Conditional share', 'Expected per level'],
      numeric: [1, 3],
      rowHeader: 0,
      rows,
      className: 'rows',
    })}
</section>`;
  }).join('\n');
  return renderPage(es.ctx, {
    path: p,
    section: 'enemies',
    title: 'Enemy families',
    description: `Every ${es.ctx.gameTitle} enemy family and its spawn weight per level, generated from the game source.`,
    crumbs: enemyCrumbs([{label: 'Enemy families'}]),
    lede: `${ref.families.length} registered enemy families. A family is a kind of enemy with its own model and behaviour; zombie `
      + 'appearance types and outfits are variants inside the zombie family, not families.',
    body: `<p class="note">Shares are conditional on one placed spawn in that level. They describe the mix, not how many enemies a
level has: see <a href="${esc(href(p, ENEMIES_HOW_TO))}">How to read enemy numbers</a>.</p>
${sections}`,
  });
}

// ------------------------------------------------------------------------------------------------------------- how to read

export function renderEnemyHowTo(es: EnemySite): string {
  const p = ENEMIES_HOW_TO;
  const {ref} = es;
  const m = ref.modifiers;
  const vocab = table({
    caption: 'Terms and native units used on the enemy spawn pages',
    head: ['Term', 'Unit', 'Definition'],
    rowHeader: 0,
    rows: ref.vocabulary.map(v => [esc(v.term), prose(v.unit), prose(v.definition)]),
    rowAttrs: ref.vocabulary.map(v => `id="${esc(termAnchor(v.term))}"`),
  });
  const fields = table({
    caption: 'Room modifier fields (per room key and enemy family; neutral = 1, missing = 1)',
    head: ['Modifier', 'What it changes', 'How', 'At 0', 'At 2'],
    rowHeader: 0,
    rows: m.fields.map(f => [`${esc(modifierFieldLabel(f.field))}<span class="item-id">${esc(f.field)}</span>`, prose(f.changes), prose(f.formula), prose(f.zero), prose(f.two)]),
  });
  const body = `
<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">On this page</h2><ul>
<li><a href="#three-numbers">Three kinds of number</a></li><li><a href="#vocabulary">Terms and units</a></li><li><a href="#outcomes">Why placed counts differ</a></li><li><a href="#modifiers">Room modifiers</a></li><li><a href="#not-stated">What is never stated</a></li>
</ul></nav>

<section id="three-numbers">
<h2>Three kinds of number</h2>
${threeNumbers(es, p, false)}
</section>

<section id="vocabulary">
<h2>Terms and units</h2>
${vocab}
</section>

<section id="outcomes">
<h2>Why the placed count can differ from the count range</h2>
<p>The count a context draws is a target. The generator then walks the eligible areas and stops when the target is reached or when
nothing more fits. Each level page lists its exact rules per context; in general:</p>
<ul>
<li><strong>Eligibility.</strong> Only floor cells that pass the generator's own filter can hold a spawn: walkable floor with clear
neighbours, far enough (by walking distance) from where the player starts, away from stair and elevator landings where a level has them.
A small or crowded map has fewer such cells.</li>
<li><strong>Area order.</strong> Areas are shuffled by their area weight, so heavier areas tend to be visited first. An area weight is a
relative preference, not a chance and not a count.</li>
<li><strong>Caps per pass.</strong> The generator walks the area order in several passes, each with a higher cap: after a pass, an
ordinary area may hold up to that pass's cap, and some area kinds have their own caps (each level page lists them). Caps spread spawns
out instead of filling the first area.</li>
<li><strong>Tries and spacing.</strong> Each visit to an area tries a fixed number of random eligible cells and skips any that is too
close to an existing spawn. If all tries fail, the area gets nothing on that visit.</li>
<li><strong>Whole-attempt checks.</strong> Some levels reject a whole generation attempt that breaks a rule (for example too few
enemies) and retry with another attempt seed.</li>
</ul>
<p>So the count range is an upper bound per run: placed ≤ drawn. Family shares and zombie types apply to the spawns that are placed.</p>
</section>

<section id="modifiers">
<h2>Room modifiers</h2>
<p>${prose(m.key)} The neutral value is ${mult(m.neutral)}; a room or family without an entry resolves to ${mult(m.neutral)}.</p>
${fields}
<ul>
<li><strong>All families.</strong> ${prose(m.allFamilies)}</li>
<li><strong>Caps, spacing and the count.</strong> ${prose(m.caps)}</li>
<li><strong>Neutral means unchanged.</strong> ${prose(m.neutralParity)}</li>
${m.notes.map(n => `<li>${prose(n)}</li>`).join('\n')}
</ul>
<p class="note">Defined at ${enemySourceLoc(es, m.at)}.</p>
</section>

<section id="not-stated">
<h2>What these pages never state, and why</h2>
<ul>
<li><strong>No spawn rate per square metre or per square foot as a game rule.</strong> The game has no such rule: it places a count per
generation context. Where a page shows enemies per 100 m², it is a <em>sampled</em> figure: placed spawns divided by the eligible floor
the generator's own filter accepted, over a named seed corpus. It is never computed from map bounding boxes.</li>
<li><strong>No chance that a particular room holds an enemy.</strong> That depends on the generated layout: how many areas exist,
how much eligible floor each has, and what was placed before it.</li>
<li><strong>No difficulty, health or damage figures.</strong> These pages describe where and how many enemies spawn, not how they
fight.</li>
</ul>
</section>`;
  return renderPage(es.ctx, {
    path: p,
    section: 'enemies',
    title: 'How to read enemy numbers',
    description: 'Units and definitions used by the enemy spawn pages: count ranges, area weights, caps, family shares, room modifiers and sampled densities.',
    crumbs: enemyCrumbs([{label: 'How to read enemy numbers'}]),
    lede: 'Count ranges, family shares, placement rules and room modifiers: what each number on the enemy spawn pages means, and what '
      + 'it does not.',
    body,
  });
}
