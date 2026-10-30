// Task loot-reference-pages-20261030 (lane SITE): per-level pages — overview, one page per slot category, floor finds, economy.
import type {EconomyInfo, FloorVariant, HolderContext, LevelInfo, ScarcityStage} from '../lootReferenceTypes';
import {badge, chip, esc, filterBox, href, num, pct, range, renderPage, searchAttr, slug, table, type Crumb} from './html';
import {
  classBadge, groupChip, itemCell, itemName, kindAnchor, kindCell, kindInline, knobsTable, probCell, prose, shareCell, slotLabel, slotPage, sourceLoc,
  specialLink, tableLink, type Site,
} from './common';

const crumbsFor = (site: Site, level: LevelInfo, last?: string): Crumb[] => {
  const dir = site.levelDir.get(level.id)!;
  return [
    {label: 'Home', path: 'index.html'},
    {label: 'Loot tables', path: 'loot/index.html'},
    ...(last ? [{label: level.label, path: `${dir}/index.html`}, {label: last}] : [{label: level.label}]),
  ];
};

function levelNav(site: Site, level: LevelInfo, page: string): string {
  const dir = site.levelDir.get(level.id)!;
  const links: Array<[string, string]> = [
    [`${dir}/index.html`, 'Overview'],
    ...level.slots.filter(s => s.contexts.length).map(s => [slotPage(dir, s.slot), slotLabel(site, s.slot)] as [string, string]),
    [`${dir}/floor.html`, 'Floor finds'],
    [`${dir}/economy.html`, 'Scarcity & economy'],
  ];
  return `<nav class="toc" aria-label="${esc(level.label)} sections"><h2>${esc(level.label)}</h2><ul>${links
    .map(([t, label]) => (t === page ? `<li><span aria-current="page"><strong>${esc(label)}</strong></span></li>`
      : `<li><a href="${esc(href(page, t))}">${esc(label)}</a></li>`))
    .join('')}</ul></nav>`;
}

// ------------------------------------------------------------------------------------------------------------- overview

export function renderLevelOverview(site: Site, level: LevelInfo): string {
  const dir = site.levelDir.get(level.id)!;
  const p = `${dir}/index.html`;
  const prof = level.profile;
  const overrides = prof.overrides.length
    ? table({
      caption: `Overrides applied by profile ${prof.id}`,
      head: ['Knob', 'Key', 'Multiplier'],
      numeric: [2],
      rows: prof.overrides.map(o => [`<code>${esc(o.knob)}</code>`, `<code>${esc(o.key)}</code>`, num(o.multiplier)]),
    })
    : '<p>No overrides: every roll in this level uses the source values shown on these pages.</p>';
  const validation = prof.validation.length
    ? `<div class="callout"><p><strong>Profile validation reports problems:</strong></p><ul>${prof.validation.map(v => `<li>${prose(v)}</li>`).join('')}</ul></div>`
    : '';

  const slotRows = level.slots.map(s => {
    const holders = s.contexts.map(id => site.contexts.get(id)!.holder);
    const kinds = [...new Set(holders.map(h => h.kindLabel))];
    const tables = new Set(holders.map(h => h.tableId).filter(Boolean));
    const label = s.contexts.length
      ? `<a href="${esc(href(p, slotPage(dir, s.slot)))}">${esc(slotLabel(site, s.slot))}</a>`
      : `${esc(slotLabel(site, s.slot))}`;
    return [
      label,
      esc(site.ref.slots.find(x => x.id === s.slot)?.description ?? ''),
      kinds.length ? kinds.map(k => chip(k, 'kind')).join(' ') : '<span class="muted">none in this level</span>',
      String(s.contexts.length),
      String(tables.size),
    ];
  });

  const ctxs = level.contexts;
  const storeys = ctxs.storeys?.length
    ? table({
      caption: `Storeys of the one ${level.label} level (contexts, not separate levels)`,
      head: ['Storey', 'Layout levels', 'Floor-find program', 'Note'],
      rows: ctxs.storeys.map(s => [esc(s.label), esc(s.layoutLevels.join(', ')), esc(s.floorVariant), s.note ? prose(s.note) : '']),
    })
    : '';
  const companies = ctxs.companies?.length
    ? table({
      caption: 'Tenant companies (one per tower floor, seeded per run) and their floor-loot tilt',
      head: ['Company', 'Floor-loot tilt', 'Note'],
      rows: ctxs.companies.map(c => [`${esc(c.name)}<span class="item-id">${esc(c.id)}</span>`, `<code>${esc(c.tilt)}</code>`, prose(c.note)]),
    })
    : '';
  const purposes = level.purposes.length
    ? table({
      caption: `Room purposes in ${level.label}`,
      head: ['Purpose', 'Scarcity theme', 'Observed in sample levels'],
      numeric: [2],
      rows: level.purposes.map(u => [
        `${esc(u.label)}<span class="item-id">${esc(u.purpose)}</span>`,
        `<code>${esc(u.theme)}</code>`,
        u.levelsObserved ? `${u.levelsObserved} of ${u.samples}` : `declared only (0 of ${u.samples})`,
      ]),
    })
    : '';
  const specials = level.specials.length
    ? `<ul>${level.specials.map(id => {
      const s = site.specials.get(id);
      return `<li>${specialLink(site, p, id)} ${s ? classBadge(s.class) : ''}${s ? ` — ${prose(s.summary)}` : ''}</li>`;
    }).join('')}</ul>`
    : '<p>None.</p>';

  const body = `${levelNav(site, level, p)}
<h2 id="profile">Loot profile</h2>
<dl class="facts">
<dt>Profile</dt><dd><code>${esc(prof.id)}</code> — ${esc(prof.label)}</dd>
<dt>Rate tables</dt><dd>${prof.baseTables ? 'The shared base tables (today\'s numbers)' : 'Its own rate tables'}</dd>
<dt>Defined at</dt><dd>${sourceLoc(site, prof.at)}</dd>
</dl>
${overrides}
${validation}

<h2 id="slots">Surfaces &amp; containers by slot category</h2>
<p>Each slot category groups the holder kinds (surfaces, shelves, containers, fixtures) that loot can sit on or in. Open a category
to see each holder kind's table per room, its stage gates and the expected contents before fit.</p>
${table({
    caption: `${level.label}: slot categories`,
    head: ['Slot category', 'What it covers', 'Holder kinds in this level', 'Holder contexts', 'Distinct tables'],
    numeric: [3, 4],
    rowHeader: 0,
    rows: slotRows,
  })}

<h2 id="other-sources">Other sources in this level</h2>
<ul>
<li><a href="${esc(href(p, `${dir}/floor.html`))}">Loose floor finds</a>: ${esc(level.floor.label)}.</li>
<li><a href="${esc(href(p, `${dir}/economy.html`))}">Scarcity &amp; economy</a>: keep chances, re-themes, eligibility, stack sizes.</li>
</ul>
<h3 id="specials">Special sources</h3>
${specials}

<h2 id="contexts">Contexts within ${esc(level.label)}</h2>
<p>${prose(ctxs.note)}</p>
${storeys}
${companies}
${purposes}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: `${level.label} loot`,
    heading: level.label,
    description: `${level.label}: loot profile, slot categories, floor finds and special sources, generated from the game source.`,
    crumbs: crumbsFor(site, level),
    lede: prose(level.blurb),
    body,
  });
}

// ------------------------------------------------------------------------------------------------------------- slot page

function catList(entries: readonly {cat: string; weight: number; share: number; allowed?: boolean}[]): string {
  if (!entries.length) return '<span class="muted">none</span>';
  return entries.map(e => `<code>${esc(e.cat)}</code> ${pct(e.share)} <span class="muted">(${num(e.weight)})</span>${e.allowed === false ? ' <span class="muted">— not allowed here: the rolled item stays</span>' : ''}`).join('; ');
}

function scarcityText(s: ScarcityStage): string {
  if (s.exempt) return `${badge('Exempt', 'guaranteed')} Curated reward: rolled exactly — no keep cut, no re-theme, no limb conversion.`;
  const keep = Object.entries(s.keep).map(([cat, k]) => `<code>${esc(cat)}</code> ${pct(k)}`).join(', ');
  const themeFrom: Record<ScarcityStage['themeFrom'], string> = {
    purpose: 'the room purpose',
    'room-type': 'the plain room type',
    'random-holder': 'a random theme (random holder)',
    'default-public': 'the default public theme',
  };
  return `Theme <code>${esc(s.theme)}</code> (from ${themeFrom[s.themeFrom]}). Keep chance per category: ${keep || 'none'}; ammo is kept exactly as rolled.
A kept non-ammo find is on-theme with chance ${pct(s.on)}${s.onCats.length ? ` (on-theme categories: ${s.onCats.map(c => `<code>${esc(c)}</code>`).join(', ')})` : ''}.
On-theme re-pick: ${catList(s.onPick)}. Off-theme re-pick: ${catList(s.offPick)}.
${s.allow ? `Holder may only hold: ${s.allow.map(c => `<code>${esc(c)}</code>`).join(', ')}.` : 'Holder takes any category.'}
${s.securityAmmoFromPool ? 'Re-themed ammo comes from the generic pool.' : ''}`;
}

function expectedTable(site: Site, page: string, h: HolderContext): string {
  const e = h.expected;
  if (!e) return '';
  const items = [...e.items].sort((a, b) => b.units - a.units || b.pAtLeastOne - a.pAtLeastOne || (a.itemId < b.itemId ? -1 : 1));
  if (!items.length) return '<p class="muted">This context rolls no items.</p>';
  return table({
    caption: `Expected contents per holder before fit: ${h.kindLabel}${h.compartment ? ' drawers / cupboards' : ''}, ${h.areaLabel}`,
    head: ['Item', 'Group', 'Rolled lots', 'Lots after scarcity', 'Units after scarcity', 'Chance of at least one'],
    numeric: [2, 3, 4],
    rows: items.map(i => [itemCell(site, page, i.itemId), groupChip(site, i.itemId), num(i.rawLots), num(i.lots), num(i.units), probCell(i.pAtLeastOne)]),
  });
}

function occurrenceText(level: LevelInfo, h: HolderContext): string {
  const o = h.occurrence;
  const base = o.basis === 'observed'
    ? `Observed in ${o.levelsObserved} of ${o.samples} sample levels (${o.holdersObserved} holders).`
    : `Declared by the source but not placed in any of the ${o.samples} sample levels.`;
  const storeys = o.storeys?.length ? ` Storeys: ${o.storeys.map(s => esc(s)).join(', ')}.` : '';
  const companies = o.companies?.length
    ? ` Tenant floors: ${o.companies.map(c => esc(level.contexts.companies?.find(x => x.id === c)?.name ?? c)).join(', ')}.`
    : '';
  return `${esc(base)}${storeys}${companies}`;
}

function holderContextBlock(site: Site, level: LevelInfo, page: string, h: HolderContext): string {
  const anchor = site.contexts.get(h.id)!.anchor;
  const g = h.gates;
  const e = h.expected;
  const sourceText: Record<HolderContext['source'], string> = {
    own: 'its own table',
    purpose: 'the room purpose\'s table',
    legacy: 'the plain-room tables',
    fixture: 'nothing (fixture)',
    reward: 'a curated reward',
  };
  const tableNote = h.tableId ? site.ref.tables[h.tableId] : undefined;
  const summaryMeta = h.source === 'fixture'
    ? 'fixture: no loot'
    : e
      ? `${num(e.units)} units expected before fit · ${pct(e.pAny)} chance of any item`  // HTML-safe (num / pct)
      : '';
  const stages: string[] = [];
  if (h.source === 'fixture') {
    stages.push(`<li>${badge('Non-loot', 'nonloot')} Rolls nothing. ${prose(site.ref.holderKinds[h.kind]?.fixtureContents ?? '')}</li>`);
  } else {
    stages.push(`<li><strong>Empty?</strong> Empty chance ${pct(g.empty)} → P(not empty) = ${pct(g.pNotEmpty)}. ${badge('exact', 'exact')}</li>`);
    stages.push(`<li><strong>Lots.</strong> n uniform in ${range(g.lots[0], g.lots[1])}; E[n | rolled] = ${num(g.expectedLotsIfRolled)}${g.fullRoomsExtra ? `; stocked rooms add up to ${num(g.fullRoomsExtra)} extra` : ''}. ${badge('exact', 'exact')}</li>`);
    if (g.categories?.length) {
      stages.push(`<li><strong>Category per lot</strong> (plain room × holder): ${catList(g.categories)}. ${badge('conditional', 'conditional')}</li>`);
    }
    if (h.source === 'reward') {
      stages.push(`<li><strong>Picks</strong>, in roll order: ${(h.rewardPicks ?? []).map(t => tableLink(site, page, t)).join(', ')}. ${badge('conditional', 'conditional')}</li>`);
    } else {
      const t = tableNote;
      stages.push(`<li><strong>Item per lot</strong> from ${tableLink(site, page, h.tableId)}${t ? ` (${t.rows.length} rows, denominator ${num(t.denominator)})` : ''}: each row's share is conditional on one draw from this table. ${badge('conditional', 'conditional')}</li>`);
    }
    stages.push(`<li><strong>Stack size.</strong> ${g.bigBoxes ? 'Ammo boxes use the large box-count ranges.' : 'Ammo boxes use the normal box-count ranges.'} See <a href="${esc(href(page, `${site.levelDir.get(level.id)!}/economy.html#stack-sizes`))}">stack sizes</a>.</li>`);
    stages.push(`<li><strong>Scarcity.</strong> ${scarcityText(h.scarcity)}</li>`);
    if (!h.scarcity.exempt) stages.push(`<li><strong>Limb treatments.</strong> ${pct(h.scarcity.limbShare)} of healing finds become a limb treatment (share from the ${h.scarcity.limbFrom === 'holder' ? 'holder kind' : 'theme'}).</li>`);
    stages.push(`<li><strong>Fit.</strong> Each item must fit on a real surface of the holder; an item that fits nowhere is dropped. ${badge('not derivable', 'notderivable')}</li>`);
    stages.push('<li><strong>Finite and persistent.</strong> Rolled once, remembered, never refilled.</li>');
  }
  const groups = e ? Object.entries(e.byGroup).filter(([, v]) => v.units > 0 || v.lots > 0) : [];
  const totals = e
    ? `<p>Per holder, before fit: ${num(e.rawLots)} lots rolled (${num(e.rawUnits)} units); after scarcity ${num(e.lots)} lots, ${num(e.units)} units; chance of any item ${pct(e.pAny)}.${groups.length ? ` By group: ${groups.map(([g2, v]) => `${esc(g2)} ${num(v.units)}`).join(', ')}.` : ''}</p>`
    : '';
  const search = [h.kind, h.kindLabel, h.areaKey, h.areaLabel, h.tableId ?? '', ...(e?.items.map(i => `${i.itemId} ${itemName(site, i.itemId)}`) ?? [])];
  return `<details class="group" id="${esc(anchor)}" ${searchAttr(...search)}>
<summary>${esc(h.areaLabel)}${h.compartment ? ' — drawers / cupboards' : ''} <span class="summary-meta">· ${esc(sourceText[h.source])}${summaryMeta ? ` · ${summaryMeta}` : ''}</span></summary>
<div class="group-body">
<p>${classBadge(h.class)} ${occurrenceText(level, h)}</p>
<ol class="stages">${stages.join('\n')}</ol>
${totals}
${expectedTable(site, page, h)}
${h.notes.length ? `<ul class="note">${h.notes.map(n => `<li>${prose(n)}</li>`).join('')}</ul>` : ''}
</div>
</details>`;
}

export function renderSlotPage(site: Site, level: LevelInfo, slotId: string): string {
  const dir = site.levelDir.get(level.id)!;
  const p = slotPage(dir, slotId);
  const slot = site.ref.slots.find(s => s.id === slotId)!;
  const ids = level.slots.find(s => s.slot === slotId)?.contexts ?? [];
  const holders = ids.map(id => site.contexts.get(id)!.holder);
  const kinds = [...new Set(holders.map(h => h.kind))];
  const labelOf = (k: string) => holders.find(h => h.kind === k)!.kindLabel;
  const dupLabels = new Set(kinds.map(labelOf).filter((l, i, all) => all.indexOf(l) !== i));
  const kindTitle = (k: string) => `${esc(labelOf(k))}${dupLabels.has(labelOf(k)) ? ` <code>${esc(k)}</code>` : ''}`;
  const sections = kinds.map(kind => {
    const info = site.ref.holderKinds[kind];
    const hs = holders.filter(h => h.kind === kind);
    const facts = info
      ? `<dl class="facts">
<dt>Kind</dt><dd><code>${esc(info.kind)}</code> · ${info.group === 'container' ? 'container (opens)' : 'surface'}${info.openable ? ' · openable' : ''}${info.generated ? ' · generated holder' : ''} ${classBadge(info.class)}</dd>
<dt>Defaults</dt><dd>${info.defaults.empty !== undefined ? `empty ${pct(info.defaults.empty)}` : 'empty: per table'}; ${info.defaults.lots ? `lots ${range(info.defaults.lots[0], info.defaults.lots[1])}` : 'lots: per table'}${info.defaults.mod ? `; category modifier ${info.defaults.mod.map(num).join(' / ')}` : ''}</dd>
${info.ownTable ? `<dt>Own table</dt><dd>${tableLink(site, p, info.ownTable)}${info.containerThemed ? ' — container-themed: the same rows in every room' : ' — narrowed to what the room purpose stocks'}</dd>` : ''}
${info.compartmentTable ? `<dt>Drawers / cupboards</dt><dd>${tableLink(site, p, info.compartmentTable)} (a separate roll)</dd>` : ''}
<dt>May hold</dt><dd>${info.allow ? info.allow.map(c => `<code>${esc(c)}</code>`).join(', ') : 'any category'}</dd>
${info.randomHolder ? '<dt>Theme</dt><dd>Random holder: draws a random scarcity theme</dd>' : ''}
${info.limbShare !== undefined ? `<dt>Limb share</dt><dd>${pct(info.limbShare)} of healing finds become limb treatments</dd>` : ''}
${info.spill ? '<dt>When shot loose</dt><dd>Spills its finite lots (no new loot)</dd>' : ''}
${info.fixtureContents ? `<dt>Fixed contents</dt><dd>${prose(info.fixtureContents)} ${badge('Non-loot', 'nonloot')}</dd>` : ''}
</dl>`
      : '';
    return `<section id="${esc(kindAnchor(kind))}" data-filter-group>
<h2>${kindTitle(kind)} <span class="summary-meta">(${hs.length} context${hs.length === 1 ? '' : 's'})</span></h2>
${facts}
${hs.map(h => holderContextBlock(site, level, p, h)).join('\n')}
</section>`;
  }).join('\n');
  const kindToc = kinds.map(k => `<li><a href="#${esc(kindAnchor(k))}">${kindTitle(k)}</a></li>`).join('');
  const body = `${levelNav(site, level, p)}
<p>${prose(slot.description)}</p>
${slot.compartmentOf.length ? `<p class="note">Also classified here: the separate drawer / cupboard roll of ${slot.compartmentOf.map(k => `<code>${esc(k)}</code>`).join(', ')}.</p>` : ''}
<nav class="toc" aria-labelledby="kinds-title"><h2 id="kinds-title">Holder kinds</h2><ul>${kindToc}</ul></nav>
${filterBox('slot-contexts', 'Filter holders by item, room or id', 'holder contexts', 'e.g. bandage, kitchen, fridge')}
<div class="tools" data-details-tools="slot-contexts" hidden><button type="button" data-details="expand">Expand all</button><button type="button" data-details="collapse">Collapse all</button></div>
<div id="slot-contexts">
${sections}
</div>
${knobsTable(site, `Tuning knobs for the ${slot.label} slot`, slot.knobs, 'slot-knobs')}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: `${level.label}: ${slot.label}`,
    heading: `${level.label}: ${slot.label}`,
    description: `${level.label} ${slot.label} holders: tables, stage gates and expected contents before fit.`,
    crumbs: crumbsFor(site, level, slot.label),
    lede: `Every holder context of the ${esc(slot.label.toLowerCase())} slot in ${esc(level.label)}: the table it draws from in each room, its stage gates, and the exact expected contents before fit.`,
    body,
  });
}

// ------------------------------------------------------------------------------------------------------------- floor finds

function variantBlock(site: Site, page: string, v: FloorVariant, level: LevelInfo): string {
  const finds = table({
    caption: `${v.label}: finds per run`,
    head: ['Stage', 'Item', 'Units per copy', 'Copies', 'Chance', 'Expected copies attempted', 'Expected units attempted'],
    numeric: [2, 5, 6],
    rows: v.finds.map(f => [
      `<code>${esc(f.stage)}</code>${f.note ? `<span class="denom">${prose(f.note)}</span>` : ''}`,
      itemCell(site, page, f.itemId),
      num(f.count),
      f.copies ? range(f.copies[0], f.copies[1]) : '1',
      f.chance === null ? 'always' : pct(f.chance),
      num(f.expectedCopies),
      num(f.expectedUnits),
    ]),
    rowAttrs: v.finds.map(f => searchAttr(f.itemId, itemName(site, f.itemId), f.stage)),
  });
  const tilt = v.tilt
    ? `<p>Company loot tilt <code>${esc(v.tilt.id)}</code>: multipliers [med, battery, flare, food] = ${v.tilt.multipliers.map(num).join(', ')}${v.tilt.odds.length ? `; odds ${v.tilt.odds.map(num).join(', ')}` : ''}. Companies: ${v.tilt.companies.map(c => esc(level.contexts.companies?.find(x => x.id === c)?.name ?? c)).join('; ') || 'none'}</p>`
    : '';
  const totals = v.totals.length
    ? table({
      caption: `${v.label}: expected attempts per run, by item`,
      head: ['Item', 'Copies', 'Units'],
      numeric: [1, 2],
      rows: v.totals.map(t => [itemCell(site, page, t.itemId), num(t.copies), num(t.units)]),
    })
    : '';
  return `<details class="group" id="${esc(`variant-${slug(v.id)}`)}" data-filter-group open>
<summary>${esc(v.label)} <span class="summary-meta">· runs ${esc(v.runs)}</span></summary>
<div class="group-body">${tilt}${finds}${totals}</div>
</details>`;
}

export function renderFloorPage(site: Site, level: LevelInfo): string {
  const dir = site.levelDir.get(level.id)!;
  const p = `${dir}/floor.html`;
  const f = level.floor;
  const placement = f.placement.weights.length
    ? `${f.placement.weights.map(w => table({
      caption: `Placement weights: ${w.name}`,
      head: ['Area', 'Weight'],
      numeric: [1],
      rows: Object.entries(w.weights).map(([k, v]) => [`<code>${esc(k)}</code>`, num(v)]),
    })).join('\n')}`
    : '';
  const perLevel = f.perLevel
    ? `<h2 id="per-level">Per level</h2><p>${prose(f.perLevel.basis)}</p>${table({
      caption: `${level.label}: expected floor-find attempts per level`,
      head: ['Item', 'Copies', 'Units'],
      numeric: [1, 2],
      rows: f.perLevel.totals.map(t => [itemCell(site, p, t.itemId), num(t.copies), num(t.units)]),
    })}`
    : '';
  const body = `${levelNav(site, level, p)}
<p>${badge('Conditional', 'conditional')} Loose finds placed on the floor when the level layout is generated, outside any holder. Expected
counts are attempts before placement: a copy that finds no valid spot is not placed.</p>
${f.notes.length ? `<ul>${f.notes.map(n => `<li>${prose(n)}</li>`).join('')}</ul>` : ''}
${filterBox('floor-variants', 'Filter floor finds by item', 'finds')}
<div id="floor-variants">
${f.variants.map(v => variantBlock(site, p, v, level)).join('\n')}
</div>
${perLevel}
<h2 id="placement">Where finds land</h2>
<p>${badge('not derivable', 'notderivable')} ${prose(f.placement.reason)}</p>
${placement}
<h2 id="source">Source and knobs</h2>
<ul>${f.at.map(a => `<li>${sourceLoc(site, a)}</li>`).join('')}</ul>
${knobsTable(site, `Tuning knobs: ${f.label}`, f.knobs)}`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: `${level.label}: floor finds`,
    heading: `${level.label}: loose floor finds`,
    description: `${level.label} loose floor-find program: chances, copies and expected attempts.`,
    crumbs: crumbsFor(site, level, 'Floor finds'),
    lede: esc(f.label),
    body,
  });
}

// ------------------------------------------------------------------------------------------------------------- economy

function economyBody(site: Site, page: string, e: EconomyInfo): string {
  const themes = table({
    caption: 'Scarcity themes',
    head: ['Theme', 'Keep chance', 'On-theme chance', 'On-theme re-pick (conditional shares)', 'Limb share', 'Room purposes', 'Plain room types'],
    numeric: [1, 2, 4],
    rows: e.themes.map(t => [
      `<code>${esc(t.id)}</code>`,
      pct(t.keep),
      pct(t.on),
      catList(t.weights),
      pct(t.limbShare),
      t.purposes.map(x => chip(site.ref.purposes[x]?.label ?? x, 'purpose')).join(' ') || '<span class="muted">none</span>',
      t.roomTypes.map(x => chip(x, 'room')).join(' ') || '<span class="muted">none</span>',
    ]),
  });
  const offTheme = table({
    caption: 'Off-theme re-pick weights (conditional on a kept find being re-themed off-theme)',
    head: ['Category', 'Weight', 'Conditional share'],
    numeric: [1],
    rows: e.offTheme.map(o => [`<code>${esc(o.cat)}</code>`, num(o.weight), shareCell(o.share, o.weight, e.offTheme.reduce((n, x) => n + x.weight, 0))]),
  });
  const pool = table({
    caption: 'Global pool: the table a re-themed find of each category is drawn from',
    head: ['Category', 'Table'],
    rows: Object.entries(e.globalPool).map(([cat, t]) => [`<code>${esc(cat)}</code>`, tableLink(site, page, t)]),
  });
  const allow = table({
    caption: 'Eligibility: holder kinds that may only hold certain categories',
    head: ['Holder kind', 'May hold'],
    rows: e.allow.map(a => [kindCell(site, a.kind), a.cats.map(c => `<code>${esc(c)}</code>`).join(', ')]),
  });
  const boxes = table({
    caption: 'Ammo box round counts (uniform ranges)',
    head: ['Item', 'Normal holders', 'Large-box holders'],
    rows: e.boxCount.map(b => [itemCell(site, page, b.itemId), range(b.small[0], b.small[1]), range(b.big[0], b.big[1])]),
  });
  const handful = table({
    caption: 'Handful counts (loose rounds)',
    head: ['Item', 'Rounds'],
    rows: [...e.handful.map(h => [itemCell(site, page, h.itemId), range(h.range[0], h.range[1])]), ['Any other ammo', range(e.handfulFallback[0], e.handfulFallback[1])]],
  });
  const legacyAreas = table({
    caption: `Plain-room category weights (${e.legacy.cats.join(' / ')})`,
    head: ['Room type', ...e.legacy.cats.map(c => esc(c))],
    numeric: e.legacy.cats.map((_, i) => i + 1),
    rows: e.legacy.areaWeights.map(a => [`<code>${esc(a.roomType)}</code>`, ...a.weights.map(num)]),
  });
  const legacyMods = table({
    caption: `Holder modifiers on plain-room categories (${e.legacy.cats.join(' / ')})`,
    head: ['Holder kind', ...e.legacy.cats.map(c => esc(c))],
    numeric: e.legacy.cats.map((_, i) => i + 1),
    rows: e.legacy.holderMod.map(a => [kindCell(site, a.kind), ...a.mod.map(num)]),
  });
  return `
<h2 id="themes">Scarcity themes and keep chances</h2>
<p>After a holder's lots are rolled, ammo is kept exactly. Every other find survives with its theme's keep chance (per category where the
theme says so), then may be re-themed: on-theme with the on-theme chance, otherwise off-theme, always within what the holder may hold.</p>
${themes}
${offTheme}
${pool}
<h2 id="eligibility">Eligibility</h2>
${allow}
<p>Container-themed holders (their own rows in every room): ${e.containerThemed.map(k => kindInline(site, k)).join(', ') || 'none'}.</p>
<p>Random holders (random scarcity theme): ${e.randomHolders.map(k => kindInline(site, k)).join(', ') || 'none'}.</p>
<p>Theme of plain room types: ${Object.entries(e.themeOfType).map(([k, v]) => `<code>${esc(k)}</code> → <code>${esc(v)}</code>`).join(', ') || 'none'}.</p>
<h2 id="stack-sizes">Stack sizes</h2>
${boxes}
<p>Large-box holders: ${e.bigBoxHolders.map(k => kindInline(site, k)).join(', ') || 'none'}.</p>
${handful}
<h2 id="limb">Limb treatments</h2>
<p>Share of healing finds converted to a limb treatment, by theme: ${Object.entries(e.limb.share).map(([k, v]) => `<code>${esc(k)}</code> ${pct(v)}`).join(', ') || 'none'}.
Holder kinds with their own share: ${Object.entries(e.limb.holder).map(([k, v]) => `${kindInline(site, k)} ${pct(v)}`).join(', ') || 'none'}.
The treatment is drawn from ${tableLink(site, page, e.limb.poolTable)}.</p>
<h2 id="legacy">Plain-room (legacy) tables</h2>
<p>Rooms without a purpose table pick a category (room type weight × holder modifier) and then an item from that category's pool.</p>
${legacyAreas}
${legacyMods}
<p>Stocked rooms (${e.legacy.fullRooms.rooms.map(r => `<code>${esc(r)}</code>`).join(', ') || 'none'}) give ${e.legacy.fullRooms.kinds.map(k => kindInline(site, k)).join(', ') || 'no kinds'} up to ${num(e.legacy.fullRooms.extra)} extra lots.
Category pools: ${Object.entries(e.legacy.pools).map(([cat, t]) => `<code>${esc(cat)}</code> ${tableLink(site, page, t)}`).join(', ')}; vending food: ${tableLink(site, page, e.legacy.vendingFood)}.</p>
${knobsTable(site, 'Tuning knobs: scarcity and economy', e.knobs, 'economy-knobs')}`;
}

export function renderEconomyPage(site: Site, level: LevelInfo): string {
  const dir = site.levelDir.get(level.id)!;
  const p = `${dir}/economy.html`;
  return renderPage(site.ctx, {
    path: p,
    section: 'loot',
    title: `${level.label}: scarcity & economy`,
    heading: `${level.label}: scarcity & economy`,
    description: `${level.label} scarcity themes, keep chances, eligibility and stack sizes.`,
    crumbs: crumbsFor(site, level, 'Scarcity & economy'),
    lede: `The stages after a holder's table roll in ${esc(level.label)}, resolved under the level's profile.`,
    body: `${levelNav(site, level, p)}${economyBody(site, p, level.economy)}`,
  });
}
