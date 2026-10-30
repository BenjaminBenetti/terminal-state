// Task loot-reference-pages-20261030 (lane SITE): shared lookups and fragments for the loot explorer pages.
// Renders ONLY from the LootReference object (tools/pages/lootReferenceTypes.ts); it never imports game modules.
import type {
  HolderContext, LevelInfo, LootReference, LootTableInfo, OverrideKnob, Range, SourceClass, SourceLoc, SpecialSource, TuningKnob,
} from '../lootReferenceTypes';
import {badge, bar, esc, href, num, pct, range, repoLink, slug, table, type BadgeTone, type SiteContext} from './html';

export interface ContextLoc {
  level: LevelInfo;
  holder: HolderContext;
  /** Site path of the level's slot page. */
  page: string;
  anchor: string;
}

export interface Site {
  ref: LootReference;
  ctx: SiteContext;
  levelDir: Map<string, string>;
  tablePage: Map<string, string>;
  itemPage: Map<string, string>;
  contexts: Map<string, ContextLoc>;
  specials: Map<string, SpecialSource>;
}

/** Deterministic unique slugs for ids (sorted, collisions get -2, -3 …; overlong slugs are cut and suffixed). */
export function uniqueSlugs(ids: Iterable<string>, reserved: Iterable<string> = []): Map<string, string> {
  const used = new Set(reserved);
  const out = new Map<string, string>();
  for (const id of [...new Set(ids)].sort()) {
    let base = slug(id);
    if (base.length > 64) base = base.slice(0, 64).replace(/-+$/, '');
    let s = base;
    for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
    used.add(s);
    out.set(id, s);
  }
  return out;
}

export const RESERVED_LOOT_DIRS = ['index', 'how-to-read', 'holders', 'sources', 'tables', 'items'];

export function makeSite(ref: LootReference, ctx: SiteContext): Site {
  const levelSlugs = uniqueSlugs(ref.levels.map(l => l.id), RESERVED_LOOT_DIRS);
  const levelDir = new Map(ref.levels.map(l => [l.id, `loot/${levelSlugs.get(l.id)!}`]));
  const tableSlugs = uniqueSlugs(Object.keys(ref.tables), ['index']);
  const tablePage = new Map([...tableSlugs].map(([id, s]) => [id, `loot/tables/${s}.html`]));
  const itemSlugs = uniqueSlugs(Object.keys(ref.items), ['index']);
  const itemPage = new Map([...itemSlugs].map(([id, s]) => [id, `loot/items/${s}.html`]));
  const contexts = new Map<string, ContextLoc>();
  for (const level of ref.levels) {
    const anchors = uniqueSlugs(level.holders.map(h => h.id));
    for (const holder of level.holders) {
      contexts.set(holder.id, {level, holder, page: slotPage(levelDir.get(level.id)!, holder.slot), anchor: `ctx-${anchors.get(holder.id)!}`});
    }
  }
  const specials = new Map(ref.specials.map(s => [s.id, s]));
  return {ref, ctx, levelDir, tablePage, itemPage, contexts, specials};
}

export const slotPage = (levelDir: string, slotId: string): string => `${levelDir}/slot-${slug(slotId)}.html`;
export const specialAnchor = (id: string): string => `src-${slug(id)}`;
export const kindAnchor = (kind: string): string => `kind-${slug(kind)}`;
export const slotAnchor = (slotId: string): string => `slot-${slug(slotId)}`;

/** Text from the data, escaped; `backticked` spans become <code>. */
export function prose(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/ -&gt; /g, ' → ').replace(/&gt;=/g, '≥').replace(/&lt;=/g, '≤');
}

export function itemName(site: Site, itemId: string): string {
  return site.ref.items[itemId]?.name ?? itemId;
}

/** Item name linked to its page, with the stable id underneath. */
export function itemCell(site: Site, page: string, itemId: string): string {
  const item = site.ref.items[itemId];
  const target = site.itemPage.get(itemId);
  const name = esc(item?.name ?? itemId);
  return `${target ? `<a href="${esc(href(page, target))}">${name}</a>` : name}<span class="item-id">${esc(itemId)}</span>`;
}

export function groupChip(site: Site, itemId: string): string {
  const g = site.ref.items[itemId]?.group;
  if (!g) return '';
  const label = site.ref.itemGroups.find(x => x.id === g)?.label ?? g;
  return `<span class="chip chip-${slug(g)}">${esc(label)}</span>`;
}

export function tableLink(site: Site, page: string, tableId: string | null | undefined): string {
  if (!tableId) return '<span class="muted">none</span>';
  const t = site.ref.tables[tableId];
  const target = site.tablePage.get(tableId);
  const label = esc(t?.label ?? tableId);
  return target ? `<a href="${esc(href(page, target))}">${label}</a>` : label;
}

export function contextLink(site: Site, page: string, contextId: string, text?: string): string {
  const loc = site.contexts.get(contextId);
  if (!loc) return esc(text ?? contextId);
  const label = text ?? `${loc.holder.kindLabel}${loc.holder.compartment ? ' (drawers / cupboards)' : ''} — ${loc.holder.areaLabel}`;
  return `<a href="${esc(href(page, `${loc.page}#${loc.anchor}`))}">${esc(label)}</a>`;
}

export function specialLink(site: Site, page: string, id: string): string {
  const s = site.specials.get(id);
  if (!s) return esc(id);
  return `<a href="${esc(href(page, `loot/sources.html#${specialAnchor(id)}`))}">${esc(s.label)}</a>`;
}

const CLASS_LABEL: Record<SourceClass, [string, BadgeTone]> = {
  guaranteed: ['Guaranteed', 'guaranteed'],
  conditional: ['Conditional', 'conditional'],
  special: ['Special rule', 'special'],
  'non-loot': ['Non-loot', 'nonloot'],
  'decoration-only': ['Decoration only', 'decoration'],
};
export function classBadge(c: SourceClass): string {
  const label = CLASS_LABEL[c];
  if (!label) throw new Error(`Unlabelled source class ${String(c)} (add it to CLASS_LABEL)`);
  return badge(label[0], label[1]);
}

export function isRange(v: unknown): v is Range {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

export function valueText(v: number | Range | string): string {
  if (typeof v === 'number') return num(v);
  if (isRange(v)) return range(v[0], v[1]);
  return prose(v);
}

/** Share cell: bar + percentage + the weight / denominator it comes from. */
export function shareCell(share: number, weight?: number, denominator?: number): string {
  const denom = weight !== undefined && denominator !== undefined ? `<span class="denom">${num(weight)} / ${num(denominator)}</span>` : '';
  return `<div class="share-cell">${bar(share)}<span class="share-value">${pct(share)}</span></div>${denom}`;
}

/** Probability cell (bar + percentage) for exact before-fit probabilities. */
export const probCell = (p: number): string => `<div class="share-cell">${bar(p)}<span class="share-value">${pct(p)}</span></div>`;

export function sourceLoc(site: Site, at: SourceLoc): string {
  return `<code>${esc(at.symbol)}</code> in ${repoLink(site.ctx.commit, at.file, at.file + (at.line ? `:${at.line}` : ''), at.line)}`;
}

const KNOB_HELP: Record<OverrideKnob, string> = {
  itemWeight: 'per-item weight multiplier',
  categoryWeight: 'per-category weight multiplier',
  keep: 'scarcity keep multiplier',
  'slot.empty': 'slot empty-chance override',
  'slot.lots': 'slot lot-range override',
  'floor.chance': 'floor find chance multiplier',
  'floor.count': 'floor find count multiplier',
  'gear.mean': 'rare gear mean',
  'gear.cap': 'rare gear cap',
  'gear.weight': 'rare gear weights',
  rewards: 'replace the reward tables',
  tables: 'give the profile its own rate tables',
  none: 'no override reaches it: edit the source value',
};

export function overrideChips(knobs: readonly OverrideKnob[]): string {
  return knobs.map(k => `<span class="chip chip-knob" title="${esc(KNOB_HELP[k])}">${esc(k)}</span>`).join(' ');
}

export function knobsTable(site: Site, caption: string, knobs: readonly TuningKnob[], id?: string): string {
  if (!knobs.length) return '';
  return table({
    caption,
    id,
    head: ['Value', 'Current', 'Where it lives', 'Per-level override'],
    rows: knobs.map(k => [
      `${prose(k.what)}${k.note ? `<span class="denom">${prose(k.note)}</span>` : ''}`,
      valueText(k.value),
      sourceLoc(site, k.at),
      overrideChips(k.overrides),
    ]),
  });
}

/** Rows of a table sorted by weight (desc), stable on source order. */
export function sortedRows(t: LootTableInfo): LootTableInfo['rows'] {
  return t.rows.map((r, i) => ({r, i})).sort((a, b) => b.r.weight - a.r.weight || a.i - b.i).map(x => x.r);
}

export const KNOB_DESCRIPTIONS = KNOB_HELP;

/** Holder kind: human label with the stable kind id underneath (table cells). */
export function kindCell(site: Site, kind: string): string {
  const label = site.ref.holderKinds[kind]?.label;
  return label ? `${esc(label)}<span class="item-id">${esc(kind)}</span>` : `<code>${esc(kind)}</code>`;
}

/** Holder kind inline: human label, id as a tooltip-free code suffix only when there is no label. */
export function kindInline(site: Site, kind: string): string {
  const label = site.ref.holderKinds[kind]?.label;
  return label ? `${esc(label)} <code>${esc(kind)}</code>` : `<code>${esc(kind)}</code>`;
}

export function levelLabel(site: Site, id: string): string {
  return site.ref.levels.find(l => l.id === id)?.label ?? id;
}

export function slotLabel(site: Site, id: string): string {
  return site.ref.slots.find(s => s.id === id)?.label ?? id;
}
