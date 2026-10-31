// Task enemy-spawn-tables-20261030 (lane SITE): one level's enemy spawn profile page (enemies/<level>.html), rendered ONLY from the
// EnemyReference object: generation contexts with exact count ranges, the family pool with conditional shares and denominator,
// the zombie type split (a zombie sub-distribution, not families), the baseline placement rules per context, storey moves, the
// room modifier table (missing = 1×), the sampled census labelled with its corpus, and where each value is tuned.
// Task track1-siren-blightbelly-20261031 (lane SPAWN), schema 2: + the difficulty tier, the profile's family eligibility rules and
// the sampled eligibility census (draws vs placed per level of a restricted family).
import type {EligibilityCensus, EnemyLevelInfo, LevelCensus, PlacementInfo, SpawnContextInfo} from '../enemyReferenceTypes';
import {badge, esc, filterBox, href, num, range, renderPage, searchAttr, table} from './html';
import {probCell, prose, shareCell} from './common';
import {
  ALL_FAMILIES_KEY, ctxAnchor, eligAnchor, ENEMIES_HOW_TO, enemyCrumbs, enemyLevelPage, enemySourceLoc, expectedCell, familyAnchor, familyCell, familyLabel,
  keyKindLabel, labelWithId, modifierFieldLabel, modifierStatus, mult, poolShareCell, roomAnchor, uniform, ZOMBIE_FAMILY, type EnemySite,
} from './enemies';

const SECTIONS: Array<[string, string]> = [
  ['contexts', 'Generation contexts'],
  ['families', 'Enemy families'],
  ['eligibility', 'Family eligibility'],
  ['horde', 'Roaming hordes (separate pool)'],
  ['zombie-types', 'Zombie types'],
  ['placement', 'Placement rules'],
  ['storey-moves', 'Storey moves'],
  ['rooms', 'Room modifiers'],
  ['census', 'Sampled census'],
  ['how-to-read', 'How to read these numbers'],
  ['knobs', 'Where to tune it'],
];

function toc(level: EnemyLevelInfo): string {
  const shown = SECTIONS.filter(([id]) => (id === 'storey-moves' ? level.levelMoves !== null : id === 'eligibility' ? level.pool.eligibility.length > 0
    : id === 'horde' ? level.horde !== null : true));
  return `<nav class="toc" aria-label="${esc(level.name)} enemy spawn sections"><h2>On this page</h2><ul>${shown
    .map(([id, label]) => `<li><a href="#${esc(id)}">${esc(label)}</a></li>`).join('')}</ul></nav>`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

function valueText(v: number | readonly [number, number] | string): string {
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return range(v[0] as number, v[1] as number);
  return prose(v as string);
}

// ------------------------------------------------------------------------------------------------------------- contexts

function contextsSection(es: EnemySite, level: EnemyLevelInfo): string {
  // Track 2 (lane CONTENT): a zone context (service annexes) runs once per seeded zone: its per-level cells show the range over
  // 0..max zones, its expectation per zone; it is not part of the whole-level row.
  const rows = level.contexts.map(c => [
    `<a href="#${esc(ctxAnchor(c.id))}">${esc(c.label)}</a>${c.label === c.id ? '' : `<span class="item-id">${esc(c.id)}</span>`}${c.hook ? ` ${badge('data hook', 'notderivable')}` : ''}`,
    prose(c.storeys),
    c.zone ? `${range(c.zone.runsPerLevel.lo, c.zone.runsPerLevel.hi)}<span class="denom">one per zone (seeded)</span>` : num(c.runs),
    `${range(c.count.lo, c.count.hi)}<span class="denom">${esc(uniform(c.count.lo, c.count.hi))}</span>`,
    num(c.count.mean),
    c.zone ? `${range(c.zone.runsPerLevel.lo * c.count.lo, c.zone.perLevelMax)}<span class="denom">zone budget, not in the total</span>` : range(c.perLevel.lo, c.perLevel.hi),
    c.zone ? `${num(c.count.mean)}<span class="denom">per zone</span>` : num(c.perLevel.mean),
  ]);
  const zoneNotes = level.contexts.filter(c => c.zone).map(c => `<p class="note"><strong>${esc(c.label)}</strong>: ${prose(c.zone!.note)}</p>`).join('\n')
    + level.contexts.filter(c => c.families).map(c => `<p class="note"><strong>${esc(c.label)}: its own family pool</strong> (configured selection share per spawn) — ${c.families!.rows.map(r => `${esc(r.family)} ${num(Math.round(r.share * 1000) / 10)} %`).join(' · ')}. ${prose(c.families!.note)}</p>`).join('\n');
  rows.push([
    '<strong>Whole level</strong>',
    level.contexts.some(c => c.zone) ? 'all core contexts (zones reported separately)' : 'all contexts',
    '',
    '',
    '',
    `<strong>${range(level.total.lo, level.total.hi)}</strong>`,
    `<strong>${num(level.total.mean)}</strong>`,
  ]);
  return `<h2 id="contexts">Generation contexts</h2>
<p>A generation context is one run of the enemy placement code. Each run draws <strong>one</strong> count, uniformly from its range,
and tries to place that many spawns. The contexts below are parts of the one ${esc(level.name)} level and are generated with it;
they are not separate levels. A context that runs more than once per level (for example once per storey) draws a new count each run.</p>
${table({
    caption: `${level.name}: spawns each context tries to place (count per run, uniform; per level = runs × count)`,
    head: ['Context', 'Storeys one run covers', 'Runs per level', 'Count per run', 'E[count] per run', 'Per level', 'E per level'],
    numeric: [2, 4, 5, 6],
    rowHeader: 0,
    rows,
  })}
<p>${prose(level.total.note)}</p>${zoneNotes ? `\n${zoneNotes}` : ''}
<p class="note">These are targets: the generator can place fewer when it runs out of eligible, spaced floor (see
<a href="#placement">placement rules</a>). The game has no per-area or per-square-metre spawn rate; the count is spread over the
eligible areas of the context.</p>
<p>Generator: ${level.generator.at.symbol === level.generator.fn ? '' : `<code>${esc(level.generator.fn)}</code>, `}${enemySourceLoc(es, level.generator.at)}. ${prose(level.generator.note)}</p>
${level.contexts.filter(c => c.hook).map(c => `<p class="note"><strong>${esc(c.label)}</strong> (<code>${esc(c.id)}</code>): ${prose(c.hook!)}</p>`).join('\n')}
${ambientBudget(es, level)}`;
}

/** Task track3-eaton-centre-20261031 (lane PROFILES): the explicit ambient-pool caps (the horde pool has its own budget). */
function ambientBudget(es: EnemySite, level: EnemyLevelInfo): string {
  const b = level.budgets?.ambient;
  if (!b) return '';
  return `<section id="ambient-budget"><h3>Ambient budget</h3>
<dl class="facts">
<dt>Ambient spawns in the whole level</dt><dd>at most ${num(b.total)} (the contexts can try at most ${num(b.contextsMax)})</dd>
<dt>Ambient spawns of one storey run</dt><dd>at most ${num(b.perStorey)}</dd>
</dl>
<p>${prose(b.note)}${level.horde ? ' Horde members are counted in the <a href="#horde">horde pool</a>, never here.' : ''}</p>
<p class="note">Defined at ${enemySourceLoc(es, b.at)}.</p></section>`;
}

// ------------------------------------------------------------------------------------------------------------- horde
// Task track3-eaton-centre-20261031 (lane PROFILES): the separate roaming-horde pool.

function hordeSection(es: EnemySite, level: EnemyLevelInfo, p: string): string {
  const h = level.horde;
  if (!h) return '';
  const pool = table({
    caption: `${level.name}: horde family pool (its OWN explicit pool; denominator ${num(h.pool.denominator)})`,
    head: ['Family', 'Weight', 'Conditional share'],
    numeric: [1],
    rowHeader: 0,
    rows: h.pool.rows.map(r => [familyCell(es, p, r.family), num(r.weight), r.weight > 0 ? shareCell(r.share, r.weight, h.pool.denominator) : '<span class="muted">never in a horde</span>']),
  });
  return `<h2 id="horde">${esc(h.label)} <span class="summary-meta">(separate pool)</span></h2>
<dl class="facts">
<dt>Groups per level</dt><dd>${range(h.groups.lo, h.groups.hi)} <span class="denom">${esc(uniform(h.groups.lo, h.groups.hi))}</span>, E = ${num(h.groups.mean)}</dd>
<dt>Initial members per group</dt><dd>${range(h.size.lo, h.size.hi)} <span class="denom">${esc(uniform(h.size.lo, h.size.hi))}</span>, E = ${num(h.size.mean)}</dd>
<dt>Horde budget</dt><dd>at most ${num(h.budget.total)} members in the level; ${num(h.budget.perStorey)} members and ${plural(h.budget.groupsPerStorey, 'group')} starting on one storey</dd>
<dt>Members</dt><dd>E ≈ ${num(h.members.meanBeforeBudget)} before the budget; at most ${num(h.members.max)}</dd>
<dt>Member types</dt><dd>coated with chance ${num(h.zombieTypes.coatedChance)}${h.zombieTypes.atLeastOneEach ? ', at least one of each' : ''}</dd>
<dt>Starts</dt><dd>${prose(h.placement.storeys)}; ≥ ${num(h.placement.startM)} m walking from the player start; groups ≥ ${num(h.placement.groupSpacingM)} m apart; members ≥ ${num(h.placement.memberSpacingM)} m apart within ${num(h.placement.clusterM)} m of the group start; ≥ ${num(h.placement.ambientSpacingM)} m from ambient enemies</dd>
<dt>Patrol</dt><dd>${num(h.patrol.speed)} m/s roam; a leg takes a vertical link with chance ${num(h.patrol.storeyChange)}; pauses with chance ${num(h.patrol.pauseChance)} for ${range(h.patrol.pause[0], h.patrol.pause[1])} s</dd>
</dl>
<p>${prose(h.members.note)}</p>
${pool}
<ul>${h.semantics.map(t => `<li>${prose(t)}</li>`).join('')}</ul>
<p class="note">Defined at ${enemySourceLoc(es, h.at)}.</p>`;
}

// ------------------------------------------------------------------------------------------------------------- families

function familiesSection(es: EnemySite, level: EnemyLevelInfo, p: string): string {
  const pool = level.pool;
  const rows = es.ref.families.map(f => {
    const row = pool.rows.find(r => r.family === f.id);
    const expected = pool.expectedPerLevel.find(e => e.family === f.id);
    if (!row) return [familyCell(es, p, f.id), '<span class="muted">not in pool</span>', '<span class="muted">never spawns in this level</span>', '0'];
    return [familyCell(es, p, f.id), num(row.weight), poolShareCell(level, row), expectedCell(expected)];
  });
  // Pool rows the registry does not know were rejected by makeEnemySite; every registry family has a row here.
  return `<h2 id="families">Enemy families</h2>
<p>Every placed spawn is one enemy family. A family's <em>conditional share</em> = weight / Σ weights (denominator
${num(pool.denominator)}) is the chance that one placed spawn is that family. It changes the mix, not how many spawns are placed.</p>
<p>${prose(pool.roll)}</p>
${table({
    caption: `${level.name}: family pool (shares conditional on one placed spawn; denominator ${num(pool.denominator)})`,
    head: ['Family', 'Weight', 'Conditional share', 'Expected per level'],
    numeric: [1, 3],
    rowHeader: 0,
    rows,
    rowAttrs: es.ref.families.map(f => `id="${esc(familyAnchor(f.id))}"`),
    className: 'rows',
  })}
<p class="note">Expected per level = share × spawns tried per level (E = ${num(level.total.mean)}), with neutral room modifiers and before
any placement shortfall${pool.eligibility.length ? '; a family with an eligibility rule and its fallback family are measured instead (sampled placed per level, see <a href="#eligibility">family eligibility</a>)' : ''}.
Defined at ${enemySourceLoc(es, pool.at)}.</p>`;
}

// ------------------------------------------------------------------------------------------------------------- eligibility

function eligibilityCensusBlock(es: EnemySite, level: EnemyLevelInfo, p: string, c: EligibilityCensus | null): string {
  if (!c) return '<p class="note">This build contains no eligibility census: the placed share of a restricted family is not measured here.</p>';
  const ctxLabel = (id: string) => level.contexts.find(x => x.id === id)?.label ?? id;
  const placed = table({
    caption: `${level.name}: placed spawns per family (sampled eligibility census: ${c.layouts} layouts)`,
    head: ['Family', 'Placed over the sample', 'Mean per level', 'Placed share'],
    numeric: [1, 2],
    rowHeader: 0,
    rows: c.placed.map(r => [familyCell(es, p, r.family), num(r.total), num(r.perLevel), probCell(r.share)]),
  });
  const restricted = c.restricted.map(r => `${table({
    caption: `${level.name}: ${familyLabel(es, r.family)} draws vs placed (sampled: ${c.layouts} layouts)`,
    head: ['Draws (roll landed on it)', 'Placed', 'Placed per level (mean)', 'Levels with none', 'Most in one level'],
    numeric: [0, 1, 2, 3, 4],
    rows: [[num(r.draws), num(r.placed), num(r.perLevel.mean), `${num(r.perLevel.none)} of ${num(c.layouts)}`, num(r.perLevel.max)]],
  })}
${table({
    caption: `${level.name}: ${familyLabel(es, r.family)} per generated level (sampled histogram)`,
    head: ['Placed in one level', 'Layouts'],
    numeric: [0, 1],
    rows: r.perLevel.histogram.map(h => [num(h.count), num(h.layouts)]),
  })}
${r.fallbacks.length ? table({
    caption: `${level.name}: ${familyLabel(es, r.family)} draws that fell back, by the first failed criterion (sampled)`,
    head: ['Criterion', 'Draws'],
    numeric: [1],
    rows: r.fallbacks.map(f => [esc(f.reason), num(f.draws)]),
  }) : ''}
${r.byContext.length ? `<p>Placed by context: ${r.byContext.map(x => `<a href="#${esc(ctxAnchor(x.context))}">${esc(ctxLabel(x.context))}</a> ${num(x.placed)}`).join(' · ')}.</p>` : ''}`).join('\n');
  return `<div class="callout"><p>${badge('sampled', 'info')} <strong>Observed, not a rule.</strong> ${prose(c.note)}</p></div>
${placed}
${restricted}`;
}

function eligibilitySection(es: EnemySite, level: EnemyLevelInfo, p: string): string {
  const el = level.pool.eligibility;
  if (!el.length) return '';
  const blocks = el.map(e => `<section id="${esc(eligAnchor(e.family))}">
<h3>${esc(familyLabel(es, e.family))} <span class="summary-meta">· ${esc(e.family)}</span></h3>
<p>${prose(e.why)}. A draw of ${esc(familyLabel(es, e.family))} becomes ${familyCell(es, p, e.fallback)} unless <strong>every</strong> criterion holds:</p>
<ol>${e.criteria.map(c => `<li>${prose(c)}</li>`).join('')}</ol>
${e.spacing ? `<p>Whole-level spacing ${num(e.spacing.metres)} m: ${prose(e.spacing.why)}. ${enemySourceLoc(es, e.spacing.at)}</p>\n` : ''}<p class="note">Rule defined at ${enemySourceLoc(es, e.at)}.</p>
</section>`).join('\n');
  return `<h2 id="eligibility">Family eligibility</h2>
<p>A family with an eligibility rule takes a placed slot only where its rule holds. Its <em>draw</em> share (weight / Σ weights)
is exact; a draw where the rule fails becomes the fallback family, so the family's <em>placed</em> share is lower and is measured
below. The other families' draws never change (the roll is the same; nothing is renormalised).</p>
${blocks}
${eligibilityCensusBlock(es, level, p, level.eligibilityCensus)}`;
}

function zombieTypesSection(es: EnemySite, level: EnemyLevelInfo): string {
  const z = level.zombieTypes;
  const ctxLabel = (id: string) => level.contexts.find(c => c.id === id)?.label ?? id;
  const expected = z.expectedCoated.length
    ? table({
      caption: `${level.name}: expected coated share of one context run (exact, including the at-least-one-of-each rule)`,
      head: ['Context', 'Spawns in the run (n)', 'Expected coated share'],
      numeric: [1],
      rows: z.expectedCoated.map(e => [`<a href="#${esc(ctxAnchor(e.context))}">${esc(ctxLabel(e.context))}</a>`, num(e.count), probCell(e.share)]),
    })
    : '';
  return `<h2 id="zombie-types">Zombie types <span class="summary-meta">(inside the zombie family)</span></h2>
<div class="callout"><p><strong>Not separate enemy families.</strong> The types (${z.types.map(t => esc(t.type)).join(', ')}) split the ${esc(familyLabel(es, ZOMBIE_FAMILY))} family only;
the family shares above do not change with them. Wardrobe outfits are a further appearance choice, also not a family.</p></div>
${table({
    caption: `${level.name}: zombie type chance per spawn (before the at-least-one-of-each rule)`,
    head: ['Type', 'Chance per spawn'],
    rowHeader: 0,
    rows: z.types.map(t => [esc(t.type), probCell(t.chance)]),
  })}
<p>${prose(z.rule)}</p>
${expected}
<p>${prose(z.appearance)}</p>
<p class="note">Defined at ${enemySourceLoc(es, z.at)}.</p>`;
}

// ------------------------------------------------------------------------------------------------------------- placement

function placementBody(es: EnemySite, level: EnemyLevelInfo, c: SpawnContextInfo, pl: PlacementInfo): string {
  const weights = table({
    caption: `${level.name} · ${c.label}: area weights (relative order preference; first matching rule wins)`,
    head: ['Areas matching', 'Area weight', 'Why'],
    numeric: [1],
    rows: [
      ...pl.areaWeights.rules.map(r => [prose(r.match), num(r.weight), prose(r.why)]),
      ['<em>any other area</em>', num(pl.areaWeights.otherwise), ''],
    ],
  });
  const caps = table({
    caption: `${level.name} · ${c.label}: spawns one area may hold (passes ${pl.caps.passes.map(n => num(n)).join(', ')})`,
    head: ['Areas matching', 'Cap', 'Why'],
    rows: [
      ...pl.caps.rules.map(r => [prose(r.match), prose(r.cap), prose(r.why)]),
      ['<em>any other area</em>', prose(pl.caps.otherwise), ''],
    ],
  });
  const keep = pl.keepAway.length
    ? table({
      caption: `${level.name} · ${c.label}: keep-away and clearance rules`,
      head: ['Rule', 'Value', 'Unit', 'In metres'],
      numeric: [1, 3],
      rows: pl.keepAway.map(k => [prose(k.rule), num(k.value), prose(k.unit), k.metres === null ? '<span class="muted">—</span>' : num(k.metres)]),
    })
    : '';
  return `<h4>Which cells can hold a spawn</h4>
<ol>${pl.eligibility.map(e => `<li>${prose(e)}</li>`).join('')}</ol>
${keep}
<h4>Which areas are visited first</h4>
<p>${prose(pl.areaWeights.note)}</p>
${weights}
<h4>How many spawns one area may hold</h4>
<p>${prose(pl.caps.note)}</p>
${caps}
<dl class="facts">
<dt>Tries per area visit</dt><dd>${plural(pl.triesPerArea, 'random eligible cell')}</dd>
<dt>Spacing</dt><dd>at least ${num(pl.spacing.metres)} m between spawns (${prose(pl.spacing.scope)})</dd>
</dl>
<p class="note">Placement defined at ${enemySourceLoc(es, pl.at)}.</p>`;
}

/** The placement rules without the per-context walk-through: equal keys = the same cell, weight, cap, try and spacing rules. */
const rulesKey = (pl: PlacementInfo): string => JSON.stringify({...pl, explanation: []});

function placementSection(es: EnemySite, level: EnemyLevelInfo): string {
  const seen: Array<{key: string; ctx: SpawnContextInfo}> = [];
  const blocks = level.contexts.map(c => {
    const key = rulesKey(c.placement);
    const same = seen.find(s => s.key === key);
    seen.push({key, ctx: c});
    const body = same
      ? `<p>Same cell eligibility, keep-away, area weights, caps, tries and spacing as
<a href="#${esc(ctxAnchor(same.ctx.id))}">${esc(same.ctx.label)}</a> (identical source values).</p>`
      : placementBody(es, level, c, c.placement);
    const rejection = c.rejection.length
      ? `<h4>Checks that reject a whole generation attempt</h4><ul>${c.rejection.map(r => `<li>${prose(r)}</li>`).join('')}</ul>`
      : '';
    return `<section id="${esc(ctxAnchor(c.id))}">
<h3>${esc(c.label)} <span class="summary-meta">· ${esc(c.id)} · count ${range(c.count.lo, c.count.hi)} per run × ${c.zone ? `one run per zone (${range(c.zone.runsPerLevel.lo, c.zone.runsPerLevel.hi)} per level)` : plural(c.runs, 'run')}</span></h3>
<p>One run covers: ${prose(c.storeys)}. Count per run ${esc(c.count.distribution)}; E[count] = ${num(c.count.mean)}.</p>
${body}
<h4>How a run places its count, and why it can fall short</h4>
<ol>${c.placement.explanation.map(e => `<li>${prose(e)}</li>`).join('')}</ol>
${rejection}
<p class="note">Context defined at ${enemySourceLoc(es, c.at)}.</p>
</section>`;
  }).join('\n');
  return `<h2 id="placement">Baseline placement rules</h2>
<p>These are the generator's own rules for <em>where</em> the counted spawns go. Room modifiers at ${mult(es.ref.modifiers.neutral)}
leave every one of them unchanged. They are also why a generated level can hold fewer spawns than its count drew.</p>
${blocks}`;
}

function storeyMovesSection(es: EnemySite, level: EnemyLevelInfo): string {
  const m = level.levelMoves;
  if (!m) return '';
  return `<h2 id="storey-moves">Storey moves</h2>
<p>${prose(m.what)}</p>
<dl class="facts">
<dt>How many move</dt><dd>${prose(m.formula)}</dd>
<dt>Kept on the main level</dt><dd>at least ${num(m.mainKeep)}</dd>
<dt>Area weights</dt><dd>${prose(m.areaWeights)}</dd>
<dt>Passes / tries</dt><dd>${plural(m.passes, 'pass', 'passes')}, ${plural(m.triesPerArea, 'try', 'tries')} per area visit</dd>
<dt>Spacing</dt><dd>${num(m.spacing.metres)} m horizontally, ${num(m.spacing.verticalMetres)} m vertically</dd>
<dt>Keep-away</dt><dd>${plural(m.keepAwayCells, 'cell')} of walking distance from the start</dd>
<dt>Defined at</dt><dd>${enemySourceLoc(es, m.at)}</dd>
</dl>
<p class="note">Moves only relocate spawns that were already counted: the level total and the family shares are unchanged.</p>`;
}

// ------------------------------------------------------------------------------------------------------------- rooms

function roomsSection(es: EnemySite, level: EnemyLevelInfo, p: string): string {
  const mod = es.ref.modifiers;
  const fams = es.ref.families;
  const fields = table({
    caption: 'What each room modifier changes (per room key and enemy family)',
    head: ['Modifier', 'Changes', 'How', 'At 0', 'At 2'],
    rowHeader: 0,
    rows: mod.fields.map(f => [esc(modifierFieldLabel(f.field)), prose(f.changes), prose(f.formula), prose(f.zero), prose(f.two)]),
  });
  const entries = level.rooms.entries.length
    ? table({
      caption: `${level.name}: explicit room modifier entries in the profile (unset = ${num(mod.neutral)})`,
      head: ['Room key', 'Family', 'Density', 'Weight'],
      numeric: [2, 3],
      rows: level.rooms.entries.map(e => [
        `<a href="#${esc(roomAnchor(e.room))}"><code>${esc(e.room)}</code></a>`,
        e.family === ALL_FAMILIES_KEY ? `<code>${esc(e.family)}</code> (every family)` : familyCell(es, p, e.family),
        e.density === null ? '<span class="muted">unset</span>' : mult(e.density),
        e.weight === null ? '<span class="muted">unset</span>' : mult(e.weight),
      ]),
    })
    : `<p>The profile sets <strong>no explicit room modifier entries</strong>: every room key below resolves to the neutral ${mult(mod.neutral)}.</p>`;
  const cell = (v: number, from: 'default' | 'profile') => `${mult(v)}${from === 'profile' ? ` ${badge('set', 'special')}` : ''}`;
  const head = ['Room key', 'Key kind', 'Sampled room types', 'Room intensity D(room)', ...fams.flatMap(f => [`${esc(f.label)}: density`, `${esc(f.label)}: weight`])];
  // Task enemy-spawn-tables-20261030 (primary): a purpose can sit on several room types (the Office roof deck carries the preset
  // purpose 'office-stair' "Stairwell"), so show the sampled types the key actually covers.
  const typesCell = (r: (typeof level.rooms.rows)[number]) => r.types === null ? '<span class="muted">not sampled</span>'
    : r.types.map(t => `${esc(t.label)} <code>${esc(t.type)}</code>`).join(', ');
  const rows = level.rooms.rows.map(r => {
    const byFamily = fams.flatMap(f => {
      const v = r.families.find(x => x.family === f.id);
      return v ? [cell(v.density, v.from), cell(v.weight, v.from)] : [`${mult(mod.neutral)} <span class="muted">(missing)</span>`, `${mult(mod.neutral)} <span class="muted">(missing)</span>`];
    });
    return [labelWithId(r.label, r.room), esc(keyKindLabel(r.keyKind)), typesCell(r), mult(r.intensity), ...byFamily];
  });
  const filterId = `rooms-table-${level.id}`;
  return `<h2 id="rooms">Room modifiers</h2>
<div class="callout"><p><strong>${modifierStatus(es, level)}.</strong> A room key or family without an entry resolves to
${mult(mod.neutral)}, which leaves the baseline placement unchanged.</p></div>
<p>${prose(mod.key)} Two modifiers exist per room key and family. <strong>Density</strong> changes local intensity: how strongly the
room's areas are preferred when spawns are spread. <strong>Weight</strong> changes conditional composition: which family a spawn
placed in that room is. Neither changes the count range, and caps and spacing still apply. ${prose(level.rooms.note)}</p>
${fields}
${entries}
${filterBox(filterId, 'Filter room keys', 'room keys', 'e.g. washroom, office-open, platform')}
<div id="${esc(filterId)}">
${table({
    caption: `${level.name}: resolved room modifiers for every room key the level can produce (1× = neutral)`,
    head,
    numeric: [3, ...fams.flatMap((_, i) => [4 + 2 * i, 5 + 2 * i])],
    rowHeader: 0,
    rows,
    rowAttrs: level.rooms.rows.map(r => `id="${esc(roomAnchor(r.room))}" ${searchAttr(r.room, r.label, r.keyKind, ...(r.types ?? []).flatMap(t => [t.type, t.label]))}`),
  })}
</div>
<p class="note">Room intensity D(room) multiplies the room's baseline area weight (see <a href="#placement">placement rules</a>). Defined
at ${enemySourceLoc(es, mod.at)}. Meaning of each field: <a href="${esc(href(p, `${ENEMIES_HOW_TO}#modifiers`))}">room modifiers</a>.</p>`;
}

// ------------------------------------------------------------------------------------------------------------- census

const per100 = (v: number | null): string => (v === null ? '<span class="muted">no eligible floor</span>' : num(v));

function censusSection(es: EnemySite, level: EnemyLevelInfo, p: string, census: LevelCensus | null): string {
  if (!census) {
    return `<h2 id="census">Sampled census</h2>
<p>This build contains no sampled census for ${esc(level.name)}: every number on this page is a source value or an exact derivation.</p>`;
  }
  const fams = es.ref.families;
  const ctxLabel = (id: string) => level.contexts.find(c => c.id === id)?.label ?? id;
  const corpus = `${plural(census.layouts, 'generated layout')} from seeds ${esc(census.seeds.join(', '))}, ${esc(census.startWeapon)} start`;
  const byFamily = table({
    caption: `${level.name}: placed spawns per family (sampled: ${census.layouts} layouts)`,
    head: ['Family', 'Placed over the sample', 'Mean per level', 'Per 100 m² eligible floor (sampled)'],
    numeric: [1, 2, 3],
    rowHeader: 0,
    rows: census.placed.map(r => [familyCell(es, p, r.family), num(r.total), num(r.perLevel), num(r.per100m2)]),
  });
  const byContext = census.byContext.length
    ? table({
      caption: `${level.name}: placed spawns per generation context (sampled)`,
      head: ['Context', 'Eligible floor m²', 'Placed over the sample', 'Mean per level', 'Per 100 m² eligible floor (sampled)', 'Placed by family (sampled outcome)'],
      numeric: [1, 2, 3, 4],
      rowHeader: 0,
      rows: census.byContext.map(c => [`<a href="#${esc(ctxAnchor(c.context))}">${esc(ctxLabel(c.context))}</a>`, num(c.eligibleM2), num(c.placed), num(c.perLevel), per100(c.per100m2),
        Object.entries(c.byFamily).filter(([, n]) => n > 0).map(([f, n]) => `${esc(f)} ${num(n)}${c.placed ? ` (${num(Math.round(1000 * n / c.placed) / 10)} %)` : ''}`).join(' · ') || '—']),
    })
    : '';
  const byKind = census.byAreaKind.length
    ? table({
      caption: `${level.name}: placed spawns per area kind (sampled)`,
      head: ['Area kind', 'Eligible floor m²', ...fams.map(f => `${esc(f.label)} placed`), 'Per 100 m² eligible floor (sampled)'],
      numeric: [1, ...fams.map((_, i) => 2 + i), 2 + fams.length],
      rowHeader: 0,
      rows: census.byAreaKind.map(k => [esc(k.kind), num(k.eligibleM2), ...fams.map(f => num(k.placed[f.id] ?? 0)), per100(k.per100m2)]),
    })
    : '';
  const types = Object.entries(census.zombieTypes);
  const typesTable = types.length
    ? table({
      caption: `${level.name}: ${familyLabel(es, ZOMBIE_FAMILY)} spawns by type (sampled)`,
      head: ['Type', 'Placed over the sample'],
      numeric: [1],
      rowHeader: 0,
      rows: types.map(([t, n]) => [esc(t), num(n)]),
    })
    : '';
  const observed = level.rooms.rows.filter(r => r.observed);
  const unobserved = level.rooms.rows.length - observed.length;
  const rooms = observed.length
    ? table({
      caption: `${level.name}: room keys in the sample (sampled; baseline area weights as the generator assigned them)`,
      head: ['Room key', 'Baseline area weight(s)', 'Layouts with it', 'Areas', 'Eligible floor m²', ...fams.map(f => `${esc(f.label)} placed`), 'Per 100 m² eligible floor (sampled)'],
      numeric: [2, 3, 4, ...fams.map((_, i) => 5 + i), 5 + fams.length],
      rowHeader: 0,
      rows: observed.map(r => {
        const o = r.observed!;
        return [
          `<a href="#${esc(roomAnchor(r.room))}">${esc(r.label)}</a>${r.label === r.room ? '' : `<span class="item-id">${esc(r.room)}</span>`}`,
          r.baselineWeights?.length ? r.baselineWeights.map(w => num(w)).join(', ') : '<span class="muted">—</span>',
          num(o.samples),
          num(o.areas),
          num(o.eligibleM2),
          ...fams.map(f => num(o.placed[f.id] ?? 0)),
          per100(o.per100m2),
        ];
      }),
    })
    : '';
  return `<h2 id="census">Sampled census</h2>
<div class="callout"><p>${badge('sampled', 'info')} <strong>Observed, not a rule.</strong> These figures come from running the real
${esc(level.name)} generator on a small fixed corpus: ${corpus}. Eligible floor is the floor the generator's own candidate filter
accepted (${num(census.eligibleCells)} cells of ${num(census.cellM2)} m², ${num(census.eligibleM2)} m² in total), not the map's bounding
box. Densities are placed spawns per 100 m² of that eligible floor over this sample only.</p></div>
<p>${prose(census.note)}</p>
${byFamily}
${byContext}
${byKind}
${typesTable}
${rooms}
${unobserved ? `<p class="note">${plural(unobserved, 'room key')} of this level did not occur in the sample; they are still listed under
<a href="#rooms">room modifiers</a>.</p>` : ''}
${hordeCensus(es, level, census)}`;
}

/** Task track3-eaton-centre-20261031 (lane PROFILES): the separate horde pool in the sample. */
function hordeCensus(es: EnemySite, level: EnemyLevelInfo, census: LevelCensus): string {
  const h = census.horde;
  if (!h) return '';
  return `<h3>Horde members in the sample <span class="summary-meta">(separate pool)</span></h3>
<dl class="facts">
<dt>Members</dt><dd>${num(h.members)} over the sample (${num(h.perLevel)} per level)</dd>
<dt>Groups</dt><dd>${num(h.groups)} (${num(h.groupsPerLevel)} per level), ${range(h.groupSizes[0], h.groupSizes[1])} members each</dd>
<dt>By family</dt><dd>${Object.entries(h.byFamily).map(([f, n]) => `${esc(familyLabel(es, f))} ${num(n)}`).join(', ')}</dd>
<dt>By starting storey</dt><dd>${Object.entries(h.byStorey).map(([st, n]) => `storey ${esc(st)}: ${num(n)}`).join(', ')}</dd>
</dl>
<p>${prose(h.note)}${level.horde ? ' Rules: <a href="#horde">roaming hordes</a>.' : ''}</p>`;
}

// ------------------------------------------------------------------------------------------------------------- page

export function renderEnemyLevelPage(es: EnemySite, level: EnemyLevelInfo): string {
  const p = enemyLevelPage(level.id);
  const knobs = level.knobs.length
    ? table({
      caption: `${level.name}: where each enemy spawn value is tuned`,
      head: ['Value', 'Current', 'Where it lives'],
      rows: level.knobs.map(k => [`${prose(k.what)}${k.note ? `<span class="denom">${prose(k.note)}</span>` : ''}`, valueText(k.value), enemySourceLoc(es, k.at)]),
    })
    : '<p>No tuning knobs listed.</p>';
  const body = `${toc(level)}
<dl class="facts">
<dt>Level id</dt><dd><code>${esc(level.id)}</code></dd>
<dt>Difficulty tier</dt><dd>${num(level.tier.value)} — ${prose(level.tier.note)} ${enemySourceLoc(es, level.tier.at)}</dd>
<dt>Spawn profile</dt><dd>${esc(level.profile.label)} — ${enemySourceLoc(es, level.profile.at)}</dd>
<dt>Spawns tried per level</dt><dd>${range(level.total.lo, level.total.hi)} (E = ${num(level.total.mean)}), over ${plural(level.contexts.length, 'generation context')}</dd>
<dt>Room modifiers</dt><dd>${modifierStatus(es, level)}</dd>
</dl>
${contextsSection(es, level)}
${familiesSection(es, level, p)}
${eligibilitySection(es, level, p)}
${hordeSection(es, level, p)}
${zombieTypesSection(es, level)}
${placementSection(es, level)}
${storeyMovesSection(es, level)}
${roomsSection(es, level, p)}
${censusSection(es, level, p, level.census)}

<h2 id="how-to-read">How to read these numbers</h2>
<ul>
<li><strong>Count range</strong> = intensity: how many spawns one run of a context tries to place, drawn uniformly. E[count] = (lo + hi) / 2.</li>
<li><strong>Conditional share</strong> = weight / Σ weights: the chance that one <em>placed</em> spawn draws that family. It sets the mix, not the number. A family with an eligibility rule places fewer than it draws (measured, sampled).</li>
<li><strong>Area weights and caps</strong> decide where spawns go and are not chances. Eligibility, spacing, caps and tries can leave a
level with fewer spawns than the count drew.</li>
<li><strong>Per 100 m²</strong> figures are sampled over eligible floor of a named corpus, never a runtime rule.</li>
</ul>
<p>More: <a href="${esc(href(p, ENEMIES_HOW_TO))}">How to read enemy numbers</a>.</p>

<h2 id="knobs">Where to tune it</h2>
<p>Each value names the source file and export where it lives (the game repository is private).</p>
${knobs}`;
  return renderPage(es.ctx, {
    path: p,
    section: 'enemies',
    title: `${level.name} enemy spawns`,
    heading: `${level.name}: enemy spawns`,
    description: `${level.name}: enemy spawn contexts, family shares, placement rules and room modifiers, generated from the game source.`,
    crumbs: enemyCrumbs([{label: level.name}]),
    lede: prose(level.blurb),
    body,
  });
}
