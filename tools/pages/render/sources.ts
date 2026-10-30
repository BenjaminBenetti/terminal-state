// Task loot-reference-pages-20261030 (lane SITE): special sources (outside the holder tables) and the slot / holder-kind reference.
import type {SpecialFamily, SpecialSource} from '../lootReferenceTypes';
import {esc, href, num, pct, range, renderPage, table} from './html';
import {
  classBadge, itemCell, isRange, kindAnchor, knobsTable, levelLabel, probCell, prose, shareCell, slotAnchor, slotPage, sourceLoc,
  specialAnchor, tableLink, type Site,
} from './common';

const FAMILY_LABEL: Record<SpecialFamily, string> = {
  gear: 'Rare gear',
  mask: 'Gas masks and filters',
  weapon: 'Weapons and paired ammo',
  starter: 'Starter kit',
  reward: 'Curated rewards (roof cache, roof find)',
  fixture: 'Fixtures (fixed contents)',
  interaction: 'Interaction rules (pry, spill, detach)',
  decoration: 'Decoration only',
  'floor-moved': 'Moved floor finds',
};
const FAMILY_ORDER = Object.keys(FAMILY_LABEL) as SpecialFamily[];

function sourceBlock(site: Site, page: string, s: SpecialSource): string {
  const hasShare = s.items.some(i => i.share !== undefined);
  // Columns that no item of this source fills are left out.
  const allColumns: Array<{head: string; numeric?: boolean; cell: (i: SpecialSource['items'][number]) => string}> = [
    {head: 'Item', cell: i => itemCell(site, page, i.itemId)},
    {head: 'Count', cell: i => (i.count === undefined ? '' : isRange(i.count) ? range(i.count[0], i.count[1]) : num(i.count))},
    {head: 'Weight', numeric: true, cell: i => (i.weight === undefined ? '' : num(i.weight))},
    {head: 'Conditional share', cell: i => (i.share === undefined ? '' : shareCell(i.share, i.weight, s.denominator))},
    {head: 'Chance', numeric: true, cell: i => (i.chance === undefined ? '' : pct(i.chance))},
    {head: 'Note', cell: i => (i.note ? prose(i.note) : '')},
  ];
  const columns = allColumns.filter((c, ci) => ci === 0 || s.items.some(i => c.cell(i) !== ''));
  const items = s.items.length
    ? table({
      caption: `${s.label}: items${hasShare && s.denominator !== undefined ? ` (shares conditional on one pick; denominator ${num(s.denominator)})` : ''}`,
      head: columns.map(c => c.head),
      numeric: columns.flatMap((c, ci) => (c.numeric ? [ci] : [])),
      rows: s.items.map(i => columns.map(c => c.cell(i))),
    })
    : '';
  const dist = s.distribution?.length
    ? table({
      caption: `${s.label}: count distribution${s.expected !== undefined ? ` (expected ${num(s.expected)})` : ''}`,
      head: ['Count k', 'P(count = k)'],
      numeric: [0],
      rows: s.distribution.map(d => [String(d.k), probCell(d.p)]),
    })
    : '';
  const perLevel = s.perLevel?.length
    ? table({
      caption: `${s.label}: per level`,
      head: ['Level', 'Summary', 'Expected', 'Distribution'],
      numeric: [2],
      rows: s.perLevel.map(l => [
        esc(levelLabel(site, l.level)),
        prose(l.summary),
        l.expected === undefined ? '' : num(l.expected),
        l.distribution?.length ? l.distribution.map(d => `${d.k}: ${pct(d.p)}`).join(' · ') : '',
      ]),
    })
    : '';
  return `<section id="${esc(specialAnchor(s.id))}">
<h3>${esc(s.label)} ${classBadge(s.class)}</h3>
<p>${prose(s.summary)}</p>
<dl class="facts">
<dt>Levels</dt><dd>${s.levels.map(l => `<a href="${esc(href(page, `${site.levelDir.get(l)!}/index.html`))}">${esc(levelLabel(site, l))}</a>`).join(', ') || 'none'}</dd>
<dt>Probability</dt><dd>${prose(s.probability)}</dd>
${s.expected !== undefined && !s.distribution?.length ? `<dt>Expected</dt><dd>${num(s.expected)}</dd>` : ''}
<dt>Source</dt><dd>${s.at.map(a => sourceLoc(site, a)).join('<br>') || '<span class="muted">n/a</span>'}</dd>
</dl>
${items}
${dist}
${perLevel}
${knobsTable(site, `Tuning knobs: ${s.label}`, s.knobs)}
</section>`;
}

export function renderSourcesPage(site: Site): string {
  const p = 'loot/sources.html';
  const fams = FAMILY_ORDER.filter(f => site.ref.specials.some(s => s.family === f));
  const known = new Set(FAMILY_ORDER);
  const unknownFamilies = [...new Set(site.ref.specials.map(s => s.family))].filter(f => !known.has(f));
  if (unknownFamilies.length) throw new Error(`Unlabelled special-source families: ${unknownFamilies.join(', ')}`);
  const toc = fams.map(f => `<li><a href="#family-${esc(f)}">${esc(FAMILY_LABEL[f])}</a></li>`).join('');
  const body = `
<p>These sources sit outside the per-holder tables. Each is labelled: guaranteed, conditional, special rule, non-loot (rolls nothing
new) or decoration only.</p>
<nav class="toc" aria-labelledby="families-title"><h2 id="families-title">Families</h2><ul>${toc}</ul></nav>
${fams.map(f => `<section id="family-${esc(f)}">
<h2>${esc(FAMILY_LABEL[f])}</h2>
${site.ref.specials.filter(s => s.family === f).map(s => sourceBlock(site, p, s)).join('\n')}
</section>`).join('\n')}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: 'Special sources',
    description: 'Loot sources outside the holder tables: rare gear, masks, weapons and ammo, starter kit, roof cache, fixtures and interactions.',
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'Special sources'}],
    lede: 'Rare gear, gas masks and filters, weapon finds with their paired ammo, the starter kit, the roof cache, fixtures and interaction rules.',
    body,
  });
}

export function renderHoldersPage(site: Site): string {
  const p = 'loot/holders.html';
  const {ref} = site;
  const sections = ref.slots.map(slot => {
    const kinds = slot.holderKinds.map(k => ref.holderKinds[k]).filter(k => !!k);
    const levelsWith = ref.levels.filter(l => (l.slots.find(s => s.slot === slot.id)?.contexts.length ?? 0) > 0);
    return `<section id="${esc(slotAnchor(slot.id))}">
<h2>${esc(slot.label)} <span class="summary-meta">(<code>${esc(slot.id)}</code>)</span></h2>
<p>${prose(slot.description)}</p>
<p>In levels: ${levelsWith.length ? levelsWith.map(l => `<a href="${esc(href(p, slotPage(site.levelDir.get(l.id)!, slot.id)))}">${esc(l.label)}</a>`).join(', ') : '<span class="muted">no registered level uses this slot</span>'}.
${slot.compartmentOf.length ? `Also the separate drawer / cupboard roll of ${slot.compartmentOf.map(k => `<code>${esc(k)}</code>`).join(', ')}.` : ''}</p>
${kinds.length ? table({
      caption: `${slot.label}: holder kinds`,
      head: ['Holder kind', 'Type', 'Empty', 'Lots', 'Own table', 'May hold', 'Flags', 'Label'],
      rowHeader: 0,
      rows: kinds.map(k => [
        `<span id="${esc(kindAnchor(k!.kind))}">${esc(k!.label)}</span><span class="item-id">${esc(k!.kind)}</span>`,
        `${k!.group}${k!.openable ? ', opens' : ''}`,
        k!.defaults.empty !== undefined ? pct(k!.defaults.empty) : '<span class="muted">per table</span>',
        k!.defaults.lots ? range(k!.defaults.lots[0], k!.defaults.lots[1]) : '<span class="muted">per table</span>',
        k!.ownTable ? tableLink(site, p, k!.ownTable) : k!.compartmentTable ? `drawers: ${tableLink(site, p, k!.compartmentTable)}` : '<span class="muted">room table</span>',
        k!.allow ? k!.allow.map(c => `<code>${esc(c)}</code>`).join(' ') : 'any',
        [k!.containerThemed ? 'container-themed' : '', k!.randomHolder ? 'random theme' : '', k!.bigBoxes ? 'large ammo boxes' : '',
          k!.spill ? 'spills when shot loose' : '', k!.generated ? 'generated' : '', k!.limbShare !== undefined ? `limb ${pct(k!.limbShare)}` : '']
          .filter(Boolean).join(', ') || '',
        classBadge(k!.class),
      ]),
    }) : '<p class="muted">No holder kind is classified here.</p>'}
${knobsTable(site, `Tuning knobs: ${slot.label}`, slot.knobs)}
</section>`;
  }).join('\n');
  const toc = ref.slots.map(s => `<li><a href="#${esc(slotAnchor(s.id))}">${esc(s.label)}</a></li>`).join('');
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: 'Slot categories & holder kinds',
    description: 'The slot categories loot holders plug into, and each holder kind\'s defaults and eligibility.',
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'Slot categories & holder kinds'}],
    lede: `${ref.slots.length} slot categories and ${Object.keys(ref.holderKinds).length} holder kinds. A slot is a classification and an override target; each kind keeps its own numbers.`,
    body: `<nav class="toc" aria-labelledby="slots-title"><h2 id="slots-title">Slot categories</h2><ul>${toc}</ul></nav>\n${sections}`,
  });
}
