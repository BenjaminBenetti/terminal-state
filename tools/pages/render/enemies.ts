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
// Task track1-siren-blightbelly-20261031 (lane SPAWN), schema 2: + level tiers, family stats / behaviour rules, eligibility rules
// (draw share vs measured placed share) and the sampled eligibility census.
// Task studio-screacher-production-20261110-221858-01 (lane REGISTRY-DOCS), schema 3: + THE SEEDED ROSTER — which special families a
// level holds at all (its rules and every family's rule on the index and the families page, each level's rates and sampled census on
// its page: anchors `roster` and `roster-<family>`, checked by tools/pages/validate.ts), a roster-only family (weight 0 in every
// pool) and the model variants of a family with several bodies. Sampled figures name their stage: before / with the roster pass.
import {
  ENEMY_REFERENCE_SCHEMA, type EnemyFamilyInfo, type EnemyLevelInfo, type EnemyReference, type LevelRosterRow, type RoomRow, type RosterFamilyInfo, type SourceLoc,
} from '../enemyReferenceTypes';
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
/** Lane INTEG (task track3-eaton-centre-20261031): anchor of a family's eligibility rule block on a level page (spacing included). */
export const eligAnchor = (family: string): string => `elig-${slug(family)}`;

/**
 * Task studio-screacher-production-20261110-221858-01: the seeded roster's section id (the index, how-to-read and every level page) and
 * a family's place in it (its row of a level's roster table, its row of the index's table, its block on the families page).
 */
export const ROSTER_SECTION = 'roster';
export const rosterAnchor = (familyId: string): string => `roster-${slug(familyId)}`;

export interface EnemySite {
  ref: EnemyReference;
  ctx: SiteContext;
  families: Map<string, EnemyFamilyInfo>;
  levels: Map<string, EnemyLevelInfo>;
  /** The roster rule of every registered family. */
  roster: Map<string, RosterFamilyInfo>;
}

/** Labels for every roster placement policy the contract names. A new policy must be labelled here (the build throws otherwise). */
export const ROSTER_PLACE_LABEL: Record<string, string> = {
  'share-topup': 'share top-up',
  'eligible-min-one': 'at least one where a room qualifies',
  'context-one': 'exactly one, in its contexts',
  count: 'a count in place of ordinary zombies',
};

/** Labels for every way a level can stand to a family's roster roll (the contract's LevelRosterRow.eligibility). */
export const ROSTER_ELIGIBILITY_LABEL: Record<LevelRosterRow['eligibility'], string> = {
  baseline: 'always: the baseline, never rolled',
  'every-map': 'yes: every map of the level is rolled',
  layout: 'depends on the map: only a map with a spawn in its contexts is rolled',
  never: 'no: never rolled on this level',
  'zombie-free': 'no: a zombie-free level',
};

export function rosterPlaceLabel(place: string): string {
  const label = ROSTER_PLACE_LABEL[place];
  if (!label) throw new Error(`Unlabelled roster placement policy ${place} (add it to ROSTER_PLACE_LABEL in tools/pages/render/enemies.ts)`);
  return label;
}

export function rosterEligibilityLabel(eligibility: string): string {
  const label = (ROSTER_ELIGIBILITY_LABEL as Record<string, string>)[eligibility];
  if (!label) throw new Error(`Unlabelled roster eligibility ${eligibility} (add it to ROSTER_ELIGIBILITY_LABEL in tools/pages/render/enemies.ts)`);
  return label;
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
  // Task studio-screacher-production-20261110-221858-01: the seeded roster names exactly the registered families (every family decides),
  // every policy is labelled, and a roster-only family really has a rule that places it and no pool weight anywhere.
  for (const r of ref.roster.families) {
    family(r.family, 'The seeded roster');
    if (r.mode === 'seeded') rosterPlaceLabel(r.place ?? '');
    for (const lr of r.levelRates) if (!levels.has(lr.level)) throw new Error(`Roster rule of ${r.family} names unknown level ${lr.level}`);
  }
  const roster = new Map(ref.roster.families.map(r => [r.family, r]));
  if (roster.size !== ref.roster.families.length) throw new Error('The seeded roster lists a family twice');
  for (const f of ref.families) {
    const rule = roster.get(f.id);
    if (!rule) throw new Error(`Enemy family ${JSON.stringify(f.id)} has no seeded roster rule (every registered family decides: baseline or seeded)`);
    if (f.rosterOnly !== rule.rosterOnly) throw new Error(`Family ${f.id}: roster-only flag differs between the family and its roster rule`);
    if (f.rosterOnly && rule.mode !== 'seeded') throw new Error(`Roster-only family ${f.id} has no seeded roster rule: nothing could ever place it`);
  }
  for (const id of [...ref.roster.rosterOnly, ...ref.roster.order]) family(id, 'The seeded roster');
  for (const id of ref.roster.zombieFreeLevels) if (!levels.has(id)) throw new Error(`The seeded roster names unknown zombie-free level ${id}`);
  for (const level of ref.levels) {
    const at = `Level ${level.id}`;
    if (!level.contexts.length) throw new Error(`${at} has no generation contexts`);
    assertUniqueSlugs(`${at} context`, level.contexts.map(c => c.id));
    assertUniqueSlugs(`${at} room key`, level.rooms.rows.map(r => r.room));
    const contexts = new Set(level.contexts.map(c => c.id));
    const context = (id: string, where: string) => {
      if (!contexts.has(id)) throw new Error(`${at} ${where} names context ${JSON.stringify(id)}, which the level does not list`);
    };
    for (const r of level.pool.rows) {
      family(r.family, `${at} family pool`);
      if (r.weight > 0 && families.get(r.family)!.rosterOnly) throw new Error(`${at} family pool gives the roster-only family ${r.family} weight ${r.weight}`);
    }
    // the level's roster rows: exactly the registered families, each with a labelled eligibility; its census names registered families
    for (const f of ref.families) if (!level.roster.rows.some(r => r.family === f.id)) throw new Error(`${at} has no seeded roster row for family ${JSON.stringify(f.id)}`);
    for (const r of level.roster.rows) { family(r.family, `${at} seeded roster`); rosterEligibilityLabel(r.eligibility); }
    if (level.roster.zombieFree !== ref.roster.zombieFreeLevels.includes(level.id)) throw new Error(`${at}: zombie-free flag differs from the roster's list`);
    for (const r of level.roster.census?.families ?? []) family(r.family, `${at} seeded roster census`);
    for (const r of level.pool.expectedPerLevel) family(r.family, `${at} expected per level`);
    if (!Number.isInteger(level.tier.value) || level.tier.value < 0) throw new Error(`${at} has no valid difficulty tier (${String(level.tier.value)})`);
    for (const e of level.pool.eligibility) {
      family(e.family, `${at} eligibility`);
      family(e.fallback, `${at} eligibility fallback`);
      for (const c of e.contexts) context(c, `eligibility of ${e.family}`);
      if (!level.pool.rows.some(r => r.family === e.family && r.restricted)) throw new Error(`${at} eligibility of ${e.family} has no restricted pool row`);
    }
    if (level.eligibilityCensus) {
      for (const p of level.eligibilityCensus.placed) family(p.family, `${at} eligibility census`);
      for (const r of level.eligibilityCensus.restricted) { family(r.family, `${at} eligibility census`); for (const c of r.byContext) context(c.context, 'eligibility census'); }
    }
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
  return {ref, ctx, families, levels, roster};
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

/** Measured (sampled) placed share of a family in a level, or null when the level has no eligibility census. */
export function placedShare(level: EnemyLevelInfo, family: string): number | null {
  return level.eligibilityCensus?.placed.find(p => p.family === family)?.share ?? null;
}

/** True when an eligibility rule changes the family's placed share: it is restricted, or it is a restricted family's fallback. */
export function eligibilityAffects(level: EnemyLevelInfo, family: string): boolean {
  return level.pool.eligibility.some(e => e.family === family || e.fallback === family);
}

/**
 * Family shares of a level's per-spawn roll as compact text ("Infected 95% · …"); an eligibility-affected family's share is a share of
 * draws. What a level holds after the seeded roster is rosterSampledMix.
 */
function familyMix(es: EnemySite, level: EnemyLevelInfo): string {
  return level.pool.rows.map(r => `${esc(familyLabel(es, r.family))} ${pct(r.share)}${eligibilityAffects(level, r.family) ? ' of draws' : ''}`).join(' · ');
}

/**
 * A pool share cell (the per-spawn roll). A restricted family (or a restricted family's fallback) adds the share its roll and
 * eligibility rule placed — measured before the roster pass; a roster-only family says that no roll draws it.
 */
export function poolShareCell(es: EnemySite, level: EnemyLevelInfo, row: EnemyLevelInfo['pool']['rows'][number]): string {
  const cell = shareCell(row.share, row.weight, level.pool.denominator);
  if (es.families.get(row.family)?.rosterOnly) return `${cell}<span class="denom">roster-only: no per-spawn roll draws it (placed by the seeded roster alone)</span>`;
  if (row.weight === 0) {
    // a family at 0 in the level pool can still have weight in a context's OWN pool (the context-locked Strainer)
    const own = level.contexts.flatMap(c => (c.families?.rows ?? []).filter(r => r.family === row.family && r.weight > 0).map(r => `${esc(c.label)} ${pct(r.share)}`));
    if (own.length) return `${cell}<span class="denom">level pool; its weight is in a context's own pool: ${own.join(', ')}</span>`;
  }
  if (!eligibilityAffects(level, row.family)) return cell;
  const placed = placedShare(level, row.family);
  const why = row.restricted ? 'eligibility rule' : 'takes the fallback draws of an eligibility rule';
  return `${cell}<span class="denom">draw share; ${placed !== null ? `${pct(placed)} of the placed spawns after the rule, before the roster pass ${badge('sampled', 'info')}` : 'placed share not measured in this build'} (${why})</span>`;
}

// ------------------------------------------------------------------------------------------------------------- seeded roster
// Task studio-screacher-production-20261110-221858-01.

/** A level's roster row of a family (every level states every registered family's roster status; makeEnemySite checked it). */
export function rosterRow(level: EnemyLevelInfo, family: string): LevelRosterRow {
  const row = level.roster.rows.find(r => r.family === family);
  if (!row) throw new Error(`Level ${level.id} has no seeded roster row for family ${family}`);
  return row;
}

/** The chance a map of the level holds the family at all, with what it is a chance of ("60%" / "always" / "never"). */
export function rosterRateCell(es: EnemySite, level: EnemyLevelInfo, family: string): string {
  const row = rosterRow(level, family), rule = es.roster.get(family);
  const policy = rule?.place ? ` · ${esc(rosterPlaceLabel(rule.place))}` : '';
  switch (row.eligibility) {
    case 'baseline': return 'always<span class="denom">the baseline: never rolled</span>';
    case 'zombie-free': return '<span class="muted">never</span><span class="denom">a zombie-free level</span>';
    case 'never': return '<span class="muted">never</span><span class="denom">not rolled on this level</span>';
    case 'every-map': return `${pct(row.rate)}<span class="denom">of level map seeds${policy}</span>`;
    case 'layout': return `${pct(row.rate)}<span class="denom">of the map seeds whose map has a spawn in its contexts${policy}</span>`;
    default: throw new Error(`Unlabelled roster eligibility ${String(row.eligibility)}`);
  }
}

/** What the sampled roster census found for a family on a level: levels holding it, mean per level, mean per level that holds it. */
export function rosterSampleCell(level: EnemyLevelInfo, family: string): string {
  if (level.roster.zombieFree) return '<span class="muted">none: a zombie-free level</span>';
  const c = level.roster.census;
  if (!c) return '<span class="muted">not measured in this build</span>';
  const r = c.families.find(x => x.family === family);
  if (!r) return '<span class="muted">not in the sample</span>';
  const holding = r.perHoldingLevel !== null && r.holding < c.layouts ? ` · ${num(r.perHoldingLevel)} per level that holds it` : '';
  return `in ${num(r.holding)} of ${num(c.layouts)} levels · ${num(r.perLevel)} per level${holding} ${badge('sampled', 'info')}`;
}

/** The seeded families a level is rolled for, as compact text ("Blightbelly 60% · …"). */
function rosterMix(es: EnemySite, level: EnemyLevelInfo): string {
  if (level.roster.zombieFree) return 'none — a zombie-free level';
  const rolled = level.roster.rows.filter(r => r.eligibility === 'every-map' || r.eligibility === 'layout');
  return rolled.length ? rolled.map(r => `${esc(familyLabel(es, r.family))} ${pct(r.rate)}${r.eligibility === 'layout' ? ' of the maps with a spawn in its contexts' : ''}`).join(' · ') : 'no family is rolled on this level';
}

/** What the sampled levels hold with the roster applied, as compact text; null when not measured. */
function rosterSampledMix(es: EnemySite, level: EnemyLevelInfo): string | null {
  const c = level.roster.census;
  if (!c) return null;
  return c.families.filter(r => r.after > 0 || rosterRow(level, r.family).eligibility !== 'never')
    .map(r => `${esc(familyLabel(es, r.family))} ${pct(r.share)}${r.holding < c.layouts ? ` (in ${num(r.holding)} of ${num(c.layouts)} levels)` : ''}`).join(' · ');
}

/** A roster rule's chance in words: "always", or its rate with the per-level overrides. */
export function rosterRuleRate(es: EnemySite, rule: RosterFamilyInfo): string {
  if (rule.mode === 'baseline' || rule.rate === null) return 'always <span class="denom">the baseline: never rolled</span>';
  const overrides = rule.levelRates.map(lr => `${esc(es.levels.get(lr.level)?.name ?? lr.level)} ${pct(lr.rate)}`).join(', ');
  const of = rule.contexts?.length ? `of the level map seeds whose map has a spawn in its contexts (${rule.contexts.map(c => esc(c)).join(', ')})` : 'of level map seeds';
  return `${pct(rule.rate)} <span class="denom">${of}${overrides ? `; ${overrides}` : ''}</span>`;
}

/** The roster rules in plain language (the same list on the index and the how-to-read page). */
function rosterRules(es: EnemySite): string {
  return `<ul>${es.ref.roster.rules.map(r => `<li>${prose(r)}</li>`).join('\n')}</ul>`;
}

/** Expected-per-level cell: exact, sampled (eligibility census) or not measured. */
export function expectedCell(e: EnemyLevelInfo['pool']['expectedPerLevel'][number] | undefined): string {
  if (!e) return '<span class="muted">not stated</span>';
  if (e.mean === null) return '<span class="muted">not measured in this build</span>';
  return e.basis === 'sampled' ? `${num(e.mean)} ${badge('sampled', 'info')}` : num(e.mean);
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
<p><strong>On top of the per-spawn roll: the seeded roster.</strong> One roll per family per level decides whether that level holds
the family <em>at all</em>; a family rolled absent has none there, and a roster-only family is placed by the roster alone. It changes
which family an ordinary zombie slot is, never how many enemies a level has. Sampled figures say whether they were taken before or
with the roster pass. ${badge('seeded per level', 'special')}</p>
${link ? `<p class="note">Details: <a href="${esc(href(page, ENEMIES_HOW_TO))}">How to read enemy numbers</a>.</p>` : ''}`;
}

// ------------------------------------------------------------------------------------------------------------- index

export function renderEnemiesIndex(es: EnemySite): string {
  const p = ENEMIES_INDEX;
  const {ref} = es;
  const cards = ref.levels.map(level => {
    const contexts = level.contexts.map(c => `${esc(c.label)} ${range(c.count.lo, c.count.hi)}${c.zone ? ` × ${range(c.zone.runsPerLevel.lo, c.zone.runsPerLevel.hi)} zones (zone budget, not in the total)` : c.runs !== 1 ? ` × ${num(c.runs)} runs` : ''}`).join(' · ');
    return `<li class="card">
<h3><a href="${esc(href(p, enemyLevelPage(level.id)))}">${esc(level.name)}</a></h3>
<p>${prose(level.blurb)}</p>
<p class="stat">Difficulty tier: ${num(level.tier.value)}</p>
<p class="stat">Contexts (count per run): ${contexts}</p>
<p class="stat">Spawns tried per level: ${range(level.total.lo, level.total.hi)} (E = ${num(level.total.mean)})</p>
<p class="stat">Family mix of the per-spawn roll (conditional): ${familyMix(es, level)}</p>
<p class="stat">Seeded roster (chance a level's roll includes the family; a level it excludes holds none): ${rosterMix(es, level)}</p>
${(() => { const mix = rosterSampledMix(es, level); return mix === null ? '' : `<p class="stat">Sampled with the roster (${num(level.roster.census!.layouts)} levels; share of the placed ambient enemies): ${mix}</p>\n`; })()}<p class="stat">Room modifiers: ${modifierStatus(es, level)}.</p>
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
      c.zone ? `${range(c.zone.runsPerLevel.lo, c.zone.runsPerLevel.hi)} <span class="denom">one per zone</span>` : num(c.runs),
      `${range(c.count.lo, c.count.hi)} <span class="denom">${esc(uniform(c.count.lo, c.count.hi))}</span>`,
      num(c.count.mean),
      c.zone ? `${range(c.zone.runsPerLevel.lo * c.count.lo, c.zone.perLevelMax)} <span class="denom">zone budget (E = ${num(c.count.mean)} per zone)</span>` : `${range(c.perLevel.lo, c.perLevel.hi)} <span class="denom">E = ${num(c.perLevel.mean)}</span>`,
    ])),
  });

  const mixHead = ['Family', ...ref.levels.map(l => esc(l.name))];
  const mix = table({
    caption: 'Family mix by level: the per-spawn roll\'s conditional share of one placed spawn (weight / Σ weights of that level\'s pool), before the seeded roster',
    head: mixHead,
    rowHeader: 0,
    rows: ref.families.map(f => [
      familyCell(es, p, f.id),
      ...ref.levels.map(level => {
        const row = level.pool.rows.find(r => r.family === f.id);
        return row ? poolShareCell(es, level, row) : '<span class="muted">not in this level\'s pool</span>';
      }),
    ]),
    className: 'rows',
  });

  // Task studio-screacher-production-20261110-221858-01: the seeded roster — the chance per level, each family's rule, the sampled outcome
  const rosterRates = table({
    caption: 'Seeded roster: chance that a generated level\'s roll includes the family (one roll per family per level map seed; a level whose roll excludes it holds none)',
    head: mixHead,
    rowHeader: 0,
    rows: ref.families.map(f => [familyCell(es, p, f.id), ...ref.levels.map(level => rosterRateCell(es, level, f.id))]),
    rowAttrs: ref.families.map(f => `id="${esc(rosterAnchor(f.id))}"`),
    className: 'rows',
  });
  const rosterPolicies = table({
    caption: 'Seeded roster: each family\'s rule (how a family the level holds is placed)',
    head: ['Family', 'Chance per level', 'How a present family is placed', 'Why', 'Defined at'],
    rowHeader: 0,
    rows: ref.roster.families.map(r => [
      `${familyCell(es, p, r.family)}${r.rosterOnly ? ` ${badge('roster-only', 'special')}` : ''}`,
      rosterRuleRate(es, r), prose(r.placement), prose(r.why), enemySourceLoc(es, r.at),
    ]),
  });
  const sampledLevels = ref.levels.filter(l => l.roster.census);
  const rosterSampled = sampledLevels.length
    ? table({
      caption: 'Seeded roster, sampled: how many of the sample levels hold the family, and how many of it per level (with the roster applied)',
      head: mixHead,
      rowHeader: 0,
      rows: ref.families.map(f => [familyCell(es, p, f.id), ...ref.levels.map(level => rosterSampleCell(level, f.id))]),
      className: 'rows',
    }) + `<p class="note">${badge('sampled', 'info')} A small sample (${sampledLevels.map(l => `${esc(l.name)} ${num(l.roster.census!.layouts)}`).join(', ')} generated levels): it shows what such levels hold, not the long-run rates — those are the chances in the table above. Each level page has the full roster census.</p>`
    : '<p>This build contains no sampled roster census.</p>';
  const rosterOnlyNames = ref.roster.rosterOnly.map(id => esc(familyLabel(es, id))).join(', ');

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
<p>Each registered enemy family and its share in each level's pool: what the per-spawn roll draws. Different levels can mix families
differently. A family at weight 0 in a level's pool is never drawn there by that roll${rosterOnlyNames ? `; a roster-only family (${rosterOnlyNames}) is at 0 in
every pool and is placed by the <a href="#${ROSTER_SECTION}">seeded roster</a> alone` : ''}. <a href="${esc(href(p, ENEMIES_FAMILIES))}">All families</a>.</p>
${mix}

<h2 id="${ROSTER_SECTION}">The seeded roster</h2>
<p>The per-spawn roll decides what one placed spawn is. The <strong>seeded roster</strong> (roster version ${num(ref.roster.version)}) then decides which
special families a generated level holds <em>at all</em>: one level has a family and the next has none of it, instead of a thin
sprinkle everywhere. Defined at ${enemySourceLoc(es, ref.roster.at)}.</p>
${rosterRules(es)}
${rosterRates}
${rosterPolicies}
${rosterSampled}

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
      const rosterCells = [rosterRateCell(es, level, f.id), rosterSampleCell(level, f.id)];
      return row
        ? [link, num(row.weight), poolShareCell(es, level, row), expectedCell(expected), ...rosterCells]
        : [link, '<span class="muted">not in pool</span>', '<span class="muted">never drawn here</span>', '0', ...rosterCells];
    });
    // Task studio-screacher-production-20261110-221858-01: the family's seeded roster rule (every family has one: baseline or seeded)
    const rule = es.roster.get(f.id)!;
    const rosterFacts: string[] = [];
    if (rule.mode === 'seeded') {
      rosterFacts.push(`<dt>Chance a level's roll includes it</dt><dd>${rosterRuleRate(es, rule)}</dd>`);
      if (rule.counts) rosterFacts.push(`<dt>How many, in a level that holds it</dt><dd>${rule.counts.map(c => `${num(c.count)} in ${pct(c.share)}`).join(', ')} of those levels${rule.countMean !== null ? ` (E = ${num(rule.countMean)} before spacing)` : ''}</dd>`);
      if (rule.slots) {
        rosterFacts.push(`<dt>Slots it may take</dt><dd>ordinary ambient zombie slots of the contexts ${rule.slots.contexts.map(c => `<code>${esc(c)}</code>`).join(', ')}, in an area with a shorter side ≥ ${num(rule.slots.minSideCells)} cells (${num(rule.slots.minSideM)} m) and ≥ ${num(rule.slots.minAreaCells)} cells (${num(rule.slots.minAreaM2)} m²)</dd>`);
        rosterFacts.push(`<dt>Never in</dt><dd>${[...rule.slots.excludeKinds.map(k => `area kind <code>${esc(k)}</code>`), ...rule.slots.excludeRooms.map(r => `<code>${esc(r)}</code>`)].join(', ') || 'no exclusion'}</dd>`);
      }
      if (rule.spacingM !== null) rosterFacts.push(`<dt>Spacing between two of it</dt><dd>${num(rule.spacingM)} m (straight 3D line), where the level allows it</dd>`);
      if (rule.contexts) rosterFacts.push(`<dt>Its contexts</dt><dd>${rule.contexts.map(c => `<code>${esc(c)}</code>`).join(', ')}</dd>`);
      if (rule.variants?.length) rosterFacts.push(`<dt>Model variants dealt</dt><dd>${rule.variants.map(v => `<code>${esc(v)}</code>`).join(', ')}, in turn from a seeded start</dd>`);
      if (rule.since !== null) rosterFacts.push(`<dt>Applies from roster version</dt><dd>${num(rule.since)} (current: ${num(ref.roster.version)})</dd>`);
      // task studio-bb-production-20261112-234540-01: a family added in a later roster version is placed after all the others
      if (rule.last) rosterFacts.push('<dt>Placement order</dt><dd>last: after every family of an earlier roster version has its slots, whatever their policies</dd>');
    }
    // the roll depends on the level seed, the family and the rate only: levels with the same rate share one row
    const rollGroups = new Map<string, {rate: number; present: number; seeds: number; levels: string[]}>();
    for (const level of ref.levels) {
      const r = rosterRow(level, f.id);
      if (!r.rolled) continue;
      const key = `${r.rate}:${r.rolled.present}:${r.rolled.seeds}`;
      const g = rollGroups.get(key) ?? {rate: r.rate, present: r.rolled.present, seeds: r.rolled.seeds, levels: []};
      g.levels.push(level.name);
      rollGroups.set(key, g);
    }
    const rollCheck = rollGroups.size
      ? table({
        caption: `${f.label}: the roster roll itself over level seeds 1 to ${ref.roster.rollCheckSeeds} (the hash alone; no level is generated)`,
        head: ['Levels', 'Rate', 'Seeds whose roll includes it', 'Share of those seeds'],
        numeric: [1, 2, 3],
        rowHeader: 0,
        rows: [...rollGroups.values()].map(g => [esc(g.levels.join(', ')), pct(g.rate), `${num(g.present)} of ${num(g.seeds)}`, pct(g.present / g.seeds)]),
      })
      : '';
    const rosterBlock = `<section id="${esc(rosterAnchor(f.id))}">
<h3>Seeded roster</h3>
${f.rosterOnly ? `<div class="callout"><p>${badge('roster-only', 'special')} <strong>Weight 0 in every level, context and horde pool.</strong> No per-spawn roll can draw this family, so its conditional share is 0 everywhere. It is placed only by the seeded roster: a level whose seed rolls it present gets its count in place of ordinary zombies, and every other level has exactly none.</p></div>` : ''}
<p>${prose(rule.placement)}</p>
<p>${prose(rule.why)}.</p>
${rosterFacts.length ? `<dl class="facts">\n${rosterFacts.join('\n')}\n</dl>` : ''}
${rollCheck}
<p class="note">Rule defined at ${enemySourceLoc(es, rule.at)}. How the roster works: <a href="${esc(href(p, `${ENEMIES_INDEX}#${ROSTER_SECTION}`))}">the seeded roster</a>.</p>
</section>`;
    const modelCell = f.model ? `<code>${esc(f.model)}</code>`
      : f.variantModels?.length ? `${f.variantModels.map(v => `<code>${esc(v.model)}</code> <span class="denom">variant ${esc(v.variant)}${v.name ? `: ${esc(v.name)}` : ''}</span>`).join(' ')} ${num(f.variantModels.length)} bodies of one enemy type`
        : 'The zombie wardrobe (outfits chosen when the enemy spawns)';
    const stat = (v: number | null, unit: string) => (v === null ? '<span class="muted">brain default</span>' : `${num(v)} ${esc(unit)}`);
    const stats = f.stats.length
      ? table({
        caption: `${f.label}: combat figures (read from the family's exported stats)`,
        head: [f.stats.some(v => v.variant) ? 'Type' : 'Family', 'Health', 'Wander speed', 'Chase speed', 'Attack range', 'Damage per hit', 'Swing / lands at / recovery', 'Sight range', 'Body radius', 'Defined at'],
        rowHeader: 0,
        rows: f.stats.map(v => [
          v.variant ? esc(v.variant) : esc(f.label), stat(v.hp, 'hp'), stat(v.wanderSpeed, 'm/s'), stat(v.chaseSpeed, 'm/s'), stat(v.attackRange, 'm'),
          stat(v.attackDamage, 'hp'), `${num(v.attackDuration)} s / ${num(v.attackImpact)} s / ${stat(v.attackCooldown, 's')}`, stat(v.sightRange, 'm'), stat(v.radius, 'm'),
          enemySourceLoc(es, v.at),
        ]),
      })
      : '<p class="muted">No combat figures exported.</p>';
    const rules = f.rules.map(g => table({
      caption: `${f.label}: ${g.title}`,
      head: ['Rule', 'Value', 'Unit'],
      rowHeader: 0,
      rows: g.rows.map(r => [prose(r.what), typeof r.value === 'number' ? num(r.value) : prose(r.value), esc(r.unit)]),
    }) + `<p class="note">${esc(g.title)} defined at ${enemySourceLoc(es, g.at)}.</p>`).join('\n');
    const restricted = ref.levels.flatMap(level => level.pool.eligibility.filter(e => e.family === f.id).map(e =>
      `<li><a href="${esc(href(p, `${enemyLevelPage(level.id)}#elig-${slug(f.id)}`))}">${esc(level.name)}</a>: ${prose(e.why)}; elsewhere a draw becomes ${esc(familyLabel(es, e.fallback))}.</li>`));
    const levels = f.levels.length
      ? f.levels.map(id => esc(es.levels.get(id)?.name ?? id)).join(', ')
      : 'none';
    return `<section id="${esc(familyAnchor(f.id))}">
<h2>${esc(f.label)}</h2>
<dl class="facts">
<dt>Registry id</dt><dd><code>${esc(f.id)}</code></dd>
<dt>Model</dt><dd>${modelCell}</dd>
<dt>Spawns in</dt><dd>${levels}${f.levels.length ? (f.rosterOnly ? ' — where the seeded roster rolls it present' : '') : ` ${badge('no registered level spawns it', 'info')}`}</dd>
<dt>Variants inside the family</dt><dd>${f.variants ? prose(f.variants) : 'None'}</dd>
<dt>Seeded roster</dt><dd>${rosterRuleRate(es, rule)}${rule.place ? ` — ${esc(rosterPlaceLabel(rule.place))}` : ''}${f.rosterOnly ? ` ${badge('roster-only', 'special')}` : ''} (<a href="#${esc(rosterAnchor(f.id))}">its rule</a>)</dd>
<dt>Defined at</dt><dd>${enemySourceLoc(es, f.at)}</dd>
</dl>
${restricted.length ? `<p><strong>Eligibility rule</strong> (it only takes placed slots where the rule holds):</p><ul>${restricted.join('')}</ul>` : ''}
<h3>Combat and behaviour</h3>
${stats}
${rules}
${rosterBlock}
<h3>Per level</h3>
${table({
      caption: `${f.label} per level: the per-spawn roll (weight, conditional share, expected per level = share × spawns tried per level before any placement shortfall; sampled where an eligibility rule applies), then the seeded roster (the chance the level's roll includes it; what the sample levels hold with the roster applied)`,
      head: ['Level', 'Weight', 'Conditional share (per-spawn roll)', 'Expected per level by the per-spawn roll alone (before the roster)', 'Seeded roster: chance the level\'s roll includes it', 'Per level with the roster (sampled)'],
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
    body: `<p class="note">Shares are conditional on one placed spawn in that level: what the per-spawn roll draws. They describe the mix,
not how many enemies a level has. Whether a level holds a family at all is the <a href="${esc(href(p, `${ENEMIES_INDEX}#${ROSTER_SECTION}`))}">seeded roster</a>'s
roll for that level seed: see <a href="${esc(href(p, ENEMIES_HOW_TO))}">How to read enemy numbers</a>.</p>
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
<li><a href="#three-numbers">Three kinds of number</a></li><li><a href="#vocabulary">Terms and units</a></li><li><a href="#outcomes">Why placed counts differ</a></li><li><a href="#${ROSTER_SECTION}">The seeded roster</a></li><li><a href="#modifiers">Room modifiers</a></li><li><a href="#not-stated">What is never stated</a></li>
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

<section id="${ROSTER_SECTION}">
<h2>The seeded roster: which families a level holds at all</h2>
<p>A family's share says how often the per-spawn roll draws it. It does not say whether a given level has any. That is the
<strong>seeded roster</strong> (roster version ${num(ref.roster.version)}), which runs once on every finished level:</p>
${rosterRules(es)}
<p>How to read the roster figures:</p>
<ul>
<li><strong>Chance per level.</strong> A family's rate is the long-run share of level map seeds whose roll includes it. A level whose
roll excludes a family has none of it. A level whose roll includes it holds at least one, placed by the family's policy. The one
exception is a level with no slot at all where the family may stand (the Siren, for example, needs an enemy standing in a room that
qualifies): it holds none and is counted as “present without a legal slot”. The sampled roster census shows all three counts:
levels whose roll included the family, levels that hold it, and levels without a slot.</li>
<li><strong>The count never changes.</strong> A level has the same number of enemies, at the same places, with or without the roster.
A family that is present takes ordinary zombie slots; a family that is absent gives its slots back to ordinary zombies.</li>
<li><strong>Roster-only.</strong> ${ref.roster.rosterOnly.length ? `${ref.roster.rosterOnly.map(id => esc(familyLabel(es, id))).join(', ')}: weight 0 in every pool, so the share is 0 everywhere and the per-spawn tables show an empty band. The roster alone places it.` : 'No family is roster-only in this build.'}</li>
<li><strong>Sampled roster figures are small samples.</strong> “In so many of the sample levels” is what those generated levels
hold. The long-run share of levels is the rate. Each family's entry also shows the roll itself over ${num(ref.roster.rollCheckSeeds)} level seeds.</li>
<li><strong>Before and with the roster.</strong> A sampled figure of the per-spawn roll alone is labelled “before the roster pass”.
Everything described as what a level holds is measured with the roster applied.</li>
</ul>
<p>Every family's rule and each level's chances: <a href="${esc(href(p, `${ENEMIES_INDEX}#${ROSTER_SECTION}`))}">the seeded roster</a>; per family: <a href="${esc(href(p, ENEMIES_FAMILIES))}">enemy families</a>.</p>
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
<li><strong>No automatic difficulty scaling.</strong> Each level shows its explicit difficulty tier, but nothing in the game scales
counts, health, damage or loot by tier, and no enemy family is enabled by it: a level opts in to a family in its own spawn profile.
Combat figures on the families page are each family's exported source values, not tier-adjusted.</li>
<li><strong>No exact placed count for a restricted family.</strong> Where an eligibility rule applies (for example a family that
only lies in certain rooms), its draw share is exact but how many it actually places depends on the generated rooms: those figures
are measured over a named sample and labelled sampled.</li>
<li><strong>No promise that one particular level holds a special family.</strong> The seeded roster's rate is a long-run share of
level seeds. Whether one level has the family is that level seed's own roll: fixed for the seed, but not readable from a share.</li>
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
