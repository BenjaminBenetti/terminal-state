// Task loot-reference-pages-20261030 (lane SITE): deduplicated tables — an index of every distinct table and one page per table.
// A table shared by several holders, rooms or levels is shown ONCE and lists everything that draws from it (no cross-product).
import type {LootTableInfo, TableKind} from '../lootReferenceTypes';
import {badge, chip, esc, filterBox, href, num, pct, range, renderPage, searchAttr, table} from './html';
import {contextLink, groupChip, itemCell, itemName, knobsTable, prose, shareCell, sortedRows, sourceLoc, specialLink, tableLink, type Site} from './common';

export const TABLE_KIND_LABEL: Record<TableKind, string> = {
  named: 'Named shared table',
  openable: 'Openable container\'s own table',
  purpose: 'Room purpose table',
  'purpose-merged': 'Room purpose: all stock merged',
  narrowed: 'Own table narrowed to the room',
  legacy: 'Plain-room table (category × pool)',
  pool: 'Category pool',
  'reward-pick': 'Curated reward pick',
  limb: 'Limb-treatment pool',
};

const KIND_ORDER = Object.keys(TABLE_KIND_LABEL) as TableKind[];

/** Tables that reuse this table's rows (rowsFrom) or are derived from it (narrowed / merged / legacy). */
function referencedBy(site: Site, t: LootTableInfo): LootTableInfo[] {
  return Object.values(site.ref.tables)
    .filter(o => o.id !== t.id && (o.rowsFrom === t.id || (o.derivedFrom ?? []).includes(t.id)))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
}

function usedByText(site: Site, t: LootTableInfo): string {
  const refs = referencedBy(site, t).length;
  return `${t.usedBy.length}${refs ? ` <span class="denom">+ ${refs} table${refs === 1 ? '' : 's'} reuse it</span>` : ''}`;
}

const idLine = (t: LootTableInfo): string => (t.id === t.label ? '' : `<span class="item-id">${esc(t.id)}</span>`);

export function renderTablesIndex(site: Site): string {
  const p = 'loot/tables/index.html';
  const tables = Object.values(site.ref.tables);
  const unknownKinds = [...new Set(tables.map(t => t.kind))].filter(k => !KIND_ORDER.includes(k));
  if (unknownKinds.length) throw new Error(`Unlabelled table kinds (add them to TABLE_KIND_LABEL): ${unknownKinds.join(', ')}`);
  const sections = KIND_ORDER.map(kind => {
    const list = tables.filter(t => t.kind === kind).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
    if (!list.length) return '';
    return `<section id="kind-${esc(kind)}" data-filter-group>
<h2>${esc(TABLE_KIND_LABEL[kind])} <span class="summary-meta">(${list.length})</span></h2>
${table({
      caption: `${TABLE_KIND_LABEL[kind]} (${list.length})`,
      head: ['Table', 'Rows', 'Denominator', 'Own lots / empty', 'Used by'],
      numeric: [1, 2, 4],
      rowHeader: 0,
      rows: list.map(t => [
        `${tableLink(site, p, t.id)}${idLine(t)}${t.unobserved ? ` ${badge('not observed in samples', 'info')}` : ''}`,
        String(t.rows.length),
        t.emptyTable ? 'empty table' : num(t.denominator),
        `${t.lots ? `lots ${range(t.lots[0], t.lots[1])}` : ''}${t.lots && t.empty !== undefined ? '; ' : ''}${t.empty !== undefined ? `empty ${pct(t.empty)}` : ''}` || '<span class="muted">holder defaults</span>',
        usedByText(site, t),
      ]),
      rowAttrs: list.map(t => searchAttr(t.id, t.label, ...t.rows.map(r => `${r.itemId} ${itemName(site, r.itemId)}`))),
    })}
</section>`;
  }).join('\n');
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: 'All tables',
    description: 'Every distinct loot table, deduplicated, with what uses it.',
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'All tables'}],
    lede: `${tables.length} distinct tables. A table used by several holders, rooms or levels is listed once. Filter by table name, id or an item it contains.`,
    body: `${filterBox('tables-list', 'Filter tables', 'tables', 'e.g. pistol ammo, STORE_DRINKS, fridge')}
<div id="tables-list">
${sections}
</div>`,
  });
}

export function renderTablePage(site: Site, t: LootTableInfo): string {
  const p = site.tablePage.get(t.id)!;
  const rows = sortedRows(t);
  const rowsTable = t.emptyTable
    ? `<div class="callout"><p>${badge('Empty table', 'info')} This table has no rows: nothing is drawn from it on purpose.</p></div>`
    : table({
      caption: `${t.label}: rows (shares conditional on one draw from this table; denominator ${num(t.denominator)})`,
      head: ['Item', 'Group', 'Weight', 'Conditional share'],
      numeric: [2],
      rows: rows.map(r => [itemCell(site, p, r.itemId), groupChip(site, r.itemId), num(r.weight), shareCell(r.share, r.weight, t.denominator)]),
      className: 'rows',
    });
  const contexts = t.usedBy.filter(id => site.contexts.has(id));
  const specials = t.usedBy.filter(id => !site.contexts.has(id) && site.specials.has(id));
  const purposeIds = t.usedBy.filter(id => !site.contexts.has(id) && !site.specials.has(id) && id.startsWith('purpose:'));
  const tablesUsing = t.usedBy.filter(id => !site.contexts.has(id) && !site.specials.has(id) && site.ref.tables[id]);
  const unknown = t.usedBy.filter(id => !site.contexts.has(id) && !site.specials.has(id) && !site.ref.tables[id] && !id.startsWith('purpose:'));
  const reusing = referencedBy(site, t);
  const byLevel = site.ref.levels.map(level => {
    const mine = contexts.filter(id => site.contexts.get(id)!.level.id === level.id);
    if (!mine.length) return '';
    return `<h3>${esc(level.label)} <span class="summary-meta">(${mine.length} holder context${mine.length === 1 ? '' : 's'})</span></h3><ul>${mine.map(id => `<li>${contextLink(site, p, id)}</li>`).join('')}</ul>`;
  }).join('');
  const purposes = purposeIds.map(id => {
    const pid = id.slice('purpose:'.length);
    const info = site.ref.purposes[pid];
    return info ? `${chip(info.label, 'purpose')}` : `<code>${esc(pid)}</code>`;
  });
  const usedBy = `${byLevel}${purposes.length ? `<h3>Room purposes that list it <span class="summary-meta">(${purposes.length})</span></h3><p class="chips">${purposes.join(' ')}</p>` : ''}${specials.length ? `<h3>Special sources</h3><ul>${specials.map(id => `<li>${specialLink(site, p, id)}</li>`).join('')}</ul>` : ''}${tablesUsing.length ? `<h3>Tables</h3><ul>${tablesUsing.map(id => `<li>${tableLink(site, p, id)}</li>`).join('')}</ul>` : ''}${reusing.length ? `<h3>Tables that reuse or narrow these rows <span class="summary-meta">(${reusing.length})</span></h3><ul>${reusing.map(o => `<li>${tableLink(site, p, o.id)} <span class="muted">(${esc(TABLE_KIND_LABEL[o.kind].toLowerCase())})</span></li>`).join('')}</ul>` : ''}${unknown.length ? `<h3>Other uses</h3><ul>${unknown.map(id => `<li><code>${esc(id)}</code></li>`).join('')}</ul>` : ''}`;
  const body = `
<dl class="facts">
<dt>Kind</dt><dd>${esc(TABLE_KIND_LABEL[t.kind])}</dd>
<dt>Stable id</dt><dd><code>${esc(t.id)}</code></dd>
<dt>Rows / denominator</dt><dd>${t.rows.length} rows · Σ weights = ${num(t.denominator)}</dd>
${t.lots ? `<dt>Own lot range</dt><dd>${range(t.lots[0], t.lots[1])}</dd>` : ''}
${t.empty !== undefined ? `<dt>Own empty chance</dt><dd>${pct(t.empty)}</dd>` : ''}
${t.rowsFrom ? `<dt>Rows from</dt><dd><code>${esc(t.rowsFrom)}</code></dd>` : ''}
${t.derivedFrom?.length ? `<dt>Derived from</dt><dd>${t.derivedFrom.map(id => (site.ref.tables[id] ? tableLink(site, p, id) : `<code>${esc(id)}</code>`)).join(', ')}</dd>` : ''}
<dt>Defined at</dt><dd>${sourceLoc(site, t.at)}</dd>
${t.unobserved ? `<dt>Sample census</dt><dd>${badge('not observed', 'info')} Declared in the source but not placed in any sample level (still a real table).</dd>` : ''}
</dl>
${t.note ? `<p>${prose(t.note)}</p>` : ''}
<p class="note">A share is the chance that ONE draw from this table picks that row. It is not the chance that a holder, a room or a
level contains the item: the holder's empty chance, lot count, scarcity and fit come on top. See
<a href="${esc(href(p, 'loot/how-to-read.html'))}">How to read the numbers</a>.</p>
${rowsTable}
<h2 id="used-by">Used by</h2>
${usedBy || '<p class="muted">Nothing draws from this table in the registered levels.</p>'}
${knobsTable(site, `Tuning knobs: ${t.label}`, t.knobs, 'knobs')}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: t.label,
    description: `Loot table ${t.label}: weights and conditional shares, generated from the game source.`,
    crumbs: [{label: 'Home', path: 'index.html'}, {label: 'Loot tables', path: 'loot/index.html'}, {label: 'All tables', path: 'loot/tables/index.html'}, {label: t.label}],
    body,
  });
}
