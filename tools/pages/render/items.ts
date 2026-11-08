// Task loot-reference-pages-20261030 (lane SITE): item index and one page per item (every table and source that can produce it).
import type {ItemInfo, OccurrenceInfo} from '../lootReferenceTypes';
import {esc, filterBox, href, num, renderPage, searchAttr, slug, table} from './html';
import {contextLink, groupChip, itemCell, probCell, shareCell, specialLink, tableLink, type Site} from './common';
import {TABLE_KIND_LABEL} from './tables';

export function renderItemsIndex(site: Site): string {
  const p = 'loot/items/index.html';
  const {ref} = site;
  const groups = ref.itemGroups.map(g => {
    const items = g.items.map(id => ref.items[id]).filter((i): i is ItemInfo => !!i);
    if (!items.length) return '';
    return `<section id="group-${esc(slug(g.id))}" data-filter-group>
<h2>${esc(g.label)} <span class="summary-meta">(${items.length})</span></h2>
${table({
      caption: `${g.label} items`,
      head: ['Item', 'Kind', 'Economy category', 'Stack', 'Tables', 'Other sources'],
      numeric: [3, 4, 5],
      rowHeader: 0,
      rows: items.map(i => [
        itemCell(site, p, i.id),
        `<code>${esc(i.kind)}</code>${i.caliber ? ` · ${esc(i.caliber)}` : ''}`,
        i.econ ? `<code>${esc(i.econ)}</code>` : '<span class="muted">none</span>',
        String(i.stackMax),
        String(i.tables.length),
        String(i.sources.length),
      ]),
      rowAttrs: items.map(i => searchAttr(i.id, i.name, i.short, i.kind, i.econ ?? '', i.group)),
    })}
</section>`;
  }).join('\n');
  const listed = new Set(ref.itemGroups.flatMap(g => g.items));
  const ungrouped = Object.keys(ref.items).filter(id => !listed.has(id)).sort();
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: 'Items',
    description: 'Every item with its human name, stable id and where it can come from.',
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'Items'}],
    lede: `${Object.keys(ref.items).length} items, grouped. Open an item to see every table, holder context, floor program and special source that can produce it.`,
    body: `${filterBox('items-list', 'Filter items', 'items', 'e.g. bandage, 9mm, ammo')}
<div id="items-list">
${groups}
${ungrouped.length ? `<section id="group-other" data-filter-group><h2>Other</h2><ul>${ungrouped.map(id => `<li ${searchAttr(id)}>${itemCell(site, p, id)}</li>`).join('')}</ul></section>` : ''}
</div>`,
  });
}

/** Task studio-base-salvage-20261108-073314-01: sampled (k of N sample levels) vs declared (possible, not sampled). */
function basisCell(o: OccurrenceInfo): string {
  return o.basis === 'observed' ? `sampled · ${o.levelsObserved} of ${o.samples}` : `<span class="muted">declared, not sampled</span>`;
}

export function renderItemPage(site: Site, item: ItemInfo): string {
  const p = site.itemPage.get(item.id)!;
  const {ref} = site;
  const tableRows = item.tables
    .map(id => ref.tables[id])
    .filter(t => !!t)
    .map(t => ({t: t!, row: t!.rows.find(r => r.itemId === item.id)}))
    .filter(x => !!x.row)
    .sort((a, b) => b.row!.share - a.row!.share || (a.t.label < b.t.label ? -1 : 1));
  const tablesHtml = tableRows.length
    ? table({
      caption: `Tables with a ${item.name} row (share = conditional on one draw from that table)`,
      head: ['Table', 'Kind', 'Weight', 'Conditional share', 'Used by'],
      numeric: [2, 4],
      rows: tableRows.map(({t, row}) => [
        tableLink(site, p, t.id),
        esc(TABLE_KIND_LABEL[t.kind]),
        num(row!.weight),
        shareCell(row!.share, row!.weight, t.denominator),
        String(t.usedBy.length),
      ]),
    })
    : '<p class="muted">No holder table lists this item.</p>';

  let contextCount = 0;
  const perLevel = ref.levels.map(level => {
    const ctxs = level.holders
      .map(h => ({h, e: h.expected?.items.find(i => i.itemId === item.id)}))
      .filter(x => x.e && (x.e.units > 0 || x.e.pAtLeastOne > 0))
      .sort((a, b) => b.e!.pAtLeastOne - a.e!.pAtLeastOne || b.e!.units - a.e!.units || (a.h.id < b.h.id ? -1 : 1));
    const floor = level.floor.variants.flatMap(v => v.finds.filter(f => f.itemId === item.id).map(f => ({v, f})));
    contextCount += ctxs.length;
    if (!ctxs.length && !floor.length) return '';
    const ctxTable = ctxs.length
      ? table({
        caption: `${level.label}: holder contexts that can yield ${item.name} (per holder, before fit)`,
        head: ['Holder context', 'Expected units', 'Chance of at least one', 'Seen in the sample levels'],
        numeric: [1],
        rows: ctxs.map(({h, e}) => [contextLink(site, p, h.id), num(e!.units), probCell(e!.pAtLeastOne), basisCell(h.occurrence)]),
        rowAttrs: ctxs.map(({h}) => searchAttr(h.kind, h.kindLabel, h.areaKey, h.areaLabel, h.slot)),
      })
      : '';
    const floorTable = floor.length
      ? table({
        caption: `${level.label}: loose floor finds of ${item.name} (attempts before placement)`,
        head: ['Program', 'Stage', 'Expected copies', 'Expected units'],
        numeric: [2, 3],
        rows: floor.map(({v, f}) => [
          `<a href="${esc(href(p, `${site.levelDir.get(level.id)!}/floor.html#variant-${slug(v.id)}`))}">${esc(v.label)}</a>`,
          `<code>${esc(f.stage)}</code>`,
          num(f.expectedCopies),
          num(f.expectedUnits),
        ]),
      })
      : '';
    return `<section id="level-${esc(slug(level.id))}" data-filter-group>
<h3>${esc(level.label)}</h3>
${ctxTable}
${floorTable}
</section>`;
  }).filter(Boolean).join('\n');

  const specials = item.sources.filter(id => site.specials.has(id));
  const otherSources = item.sources.filter(id => !site.specials.has(id));
  const body = `
<dl class="facts">
<dt>Stable id</dt><dd><code>${esc(item.id)}</code></dd>
<dt>Group</dt><dd>${groupChip(site, item.id)}</dd>
<dt>Kind</dt><dd><code>${esc(item.kind)}</code>${item.caliber ? ` · caliber ${esc(item.caliber)}` : ''}</dd>
<dt>Economy category</dt><dd>${item.econ ? `<code>${esc(item.econ)}</code>` : 'none (not a consumable resource)'}</dd>
<dt>Stack size</dt><dd>${item.stackMax}</dd>
</dl>
<p class="note">Per-holder figures are exact before fit for one holder of that context (an additive base salvage lot included). How many
such holders a level has is decided by the generator, so no per-level chance of finding ${esc(item.name)} is stated. A context is either
sampled (placed in some of the fixed sample levels) or declared (a purpose, reward or level generator can place it, but no sample level did).</p>
<h2 id="tables">Tables</h2>
${tablesHtml}
<h2 id="where">Where it can come from, per level</h2>
${contextCount > 8 ? filterBox('item-contexts', 'Filter holder contexts by room or holder', 'contexts', 'e.g. kitchen, desk') : ''}
<div id="item-contexts">
${perLevel || '<p class="muted">No holder context or floor program yields this item.</p>'}
</div>
<h2 id="special-sources">Special sources</h2>
${specials.length ? `<ul>${specials.map(id => `<li>${specialLink(site, p, id)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}
${otherSources.length ? `<p class="note">Also listed by: ${otherSources.map(id => `<code>${esc(id)}</code>`).join(', ')}.</p>` : ''}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: item.name,
    heading: item.name,
    description: `${item.name} (${item.id}): every table and source that can produce it.`,
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'Items', path: 'loot/items/index.html'}, {label: item.name}],
    lede: `${esc(item.short)} · <code>${esc(item.id)}</code>`,
    body,
  });
}
