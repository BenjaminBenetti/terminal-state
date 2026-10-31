// Task loot-reference-pages-20261030 (lane SITE): the generated reference site (tools/pages/) — output allowlist and leak checks,
// valid nested relative links, build identity on every page, coverage of the LootReference object, determinism (two full builds
// are byte-identical), the validator's own rejections, and that the game build / CI artifact are untouched. Bounded: two in-memory
// builds plus string checks; no browser, no disk output.
// Task enemy-spawn-tables-20261030 (lane SITE): + the Enemy spawns section — routes, nav from every page, data/enemies.json and its
// manifest digest, coverage of every level / context / family / room key (new entries appear automatically; unknown kinds or
// unregistered references fail the build; missing anchors fail the validator), units and "sampled" labelling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {beforeAll, describe, expect, it} from 'vitest';
import {buildSite, sourceReader} from '../../tools/pages/build';
import {OUTPUT_DIR, resolveCommit} from '../../tools/pages/cli';
import type {EnemyLevelInfo, EnemyReference} from '../../tools/pages/enemyReferenceTypes';
import type {LootReference} from '../../tools/pages/lootReferenceTypes';
import {prose} from '../../tools/pages/render/common';
import {href, NAV, num, pct, range, slug} from '../../tools/pages/render/html';
import {renderSite} from '../../tools/pages/render/site';
import {validateSite} from '../../tools/pages/validate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

let site: Map<string, string>;
let ref: LootReference;
let enemyRef: EnemyReference;

// Task track3-eaton-centre-20261031 (lane PROFILES): the full build now also samples The Eaton's Center (the largest generator) for
// both censuses — the one-off build gets a 2-minute hook budget (the default 10 s hook timeout is not a coverage rule).
beforeAll(() => {
  site = buildSite({commit: COMMIT, readSource: sourceReader(ROOT)});
  ref = JSON.parse(site.get('data/loot.json')!) as LootReference;
  enemyRef = JSON.parse(site.get('data/enemies.json')!) as EnemyReference;
}, 240000); // task track1-siren-blightbelly-20261031 (lane SPAWN): the full build now runs the 20-level eligibility census too (track3 lane PROFILES: + the mall censuses; lane INTEG: + the mall's 20-level Siren eligibility census — the whole file took ~114 s here, so 240 s keeps CI headroom)

const pages = () => [...site.keys()].filter(p => p.endsWith('.html'));
/** Copy of the site with one file replaced / added (validator rejection tests). */
const mutated = (file: string, text: string) => new Map([...site, [file, text]]);

describe('generated reference site', () => {
  it('passes the output allowlist, leak, link, structure and manifest checks', () => {
    expect(validateSite(site)).toEqual([]);
    expect(site.size).toBeGreaterThan(50);
    for (const p of site.keys()) expect(p).toMatch(/^(?:index\.html|playtest\.html|loot\/.+\.html|enemies\/[a-z0-9-]+\.html|assets\/(?:site\.css|site\.js|favicon\.svg)|data\/(?:loot|enemies|manifest)\.json)$/);
  });

  it('is deterministic: a second full build from the same source is byte-identical', () => {
    const again = buildSite({commit: COMMIT, readSource: sourceReader(ROOT)});
    expect([...again.keys()]).toEqual([...site.keys()]);
    for (const [p, text] of site) expect(again.get(p) === text, p).toBe(true);
  });

  it('shows the source commit and data digest on every page and in the manifest', () => {
    const manifest = JSON.parse(site.get('data/manifest.json')!) as {commit: string; dataHash: string; enemyDataHash: string; files: Array<{path: string}>};
    expect(manifest.commit).toBe(COMMIT);
    expect(manifest.dataHash).toBe(ref.meta.dataHash);
    expect(manifest.enemyDataHash).toBe(enemyRef.meta.dataHash);
    expect(enemyRef.meta.commit).toBe(COMMIT);
    expect(manifest.files.map(f => f.path)).toEqual([...site.keys()].filter(p => p !== 'data/manifest.json'));
    for (const p of pages()) {
      const html = site.get(p)!;
      expect(html, p).toContain(`<code>${COMMIT.slice(0, 12)}</code>`);
      expect(html, p).toContain(`data digest <code>${ref.meta.dataHash}</code>`);
      expect(html, p).toContain(`enemy spawn data digest <code>${enemyRef.meta.dataHash}</code>`);
      expect(html, p).toContain('(repository access required)');
    }
  });

  it('publishes the reference object itself as data/loot.json (finite plain JSON)', () => {
    expect(ref.meta.commit).toBe(COMMIT);
    expect(ref.levels.length).toBeGreaterThan(0);
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(ref);
  });

  it('covers every level, slot category, table, item and special source of the reference', () => {
    const index = site.get('loot/index.html')!;
    const landing = site.get('index.html')!;
    expect(landing).toContain('href="loot/index.html"');
    expect(landing).toContain('href="playtest.html"');
    for (const level of ref.levels) {
      const dir = `loot/${slug(level.id)}`;
      expect(index).toContain(`href="${slug(level.id)}/index.html"`);
      for (const page of ['index.html', 'floor.html', 'economy.html']) expect(site.has(`${dir}/${page}`), `${dir}/${page}`).toBe(true);
      const overview = site.get(`${dir}/index.html`)!;
      expect(level.slots.map(s => s.slot).sort()).toEqual(ref.slots.map(s => s.id).sort());
      for (const s of level.slots) {
        const label = ref.slots.find(x => x.id === s.slot)!.label;
        expect(overview).toContain(label);
        if (!s.contexts.length) continue;
        const slotPage = site.get(`${dir}/slot-${slug(s.slot)}.html`)!;
        expect(slotPage, `${dir} ${s.slot}`).toBeDefined();
        // Every holder context of this slot is rendered once, with its anchor.
        expect((slotPage.match(/<details class="group" id="ctx-/g) ?? []).length).toBe(s.contexts.length);
      }
      for (const id of level.specials) expect(overview).toContain(`../sources.html#src-${slug(id)}`);
    }
    for (const t of Object.values(ref.tables)) {
      const page = [...site.keys()].find(p => p.startsWith('loot/tables/') && site.get(p)!.includes(`<dt>Stable id</dt><dd><code>${t.id.replace(/&/g, '&amp;')}</code>`));
      expect(page, t.id).toBeDefined();
    }
    expect([...site.keys()].filter(p => /^loot\/tables\/(?!index\.html).+\.html$/.test(p)).length).toBe(Object.keys(ref.tables).length);
    for (const item of Object.values(ref.items)) {
      const page = site.get(`loot/items/${slug(item.id)}.html`) ?? [...site.entries()].find(([p, h]) => p.startsWith('loot/items/') && h.includes(`· <code>${item.id}</code>`))?.[1];
      expect(page, item.id).toBeDefined();
      expect(site.get('loot/items/index.html')).toContain(`<span class="item-id">${item.id}</span>`);
    }
    const sources = site.get('loot/sources.html')!;
    for (const s of ref.specials) expect(sources).toContain(`id="src-${slug(s.id)}"`);
    const holders = site.get('loot/holders.html')!;
    for (const s of ref.slots) expect(holders).toContain(`id="slot-${slug(s.id)}"`);
    for (const kind of Object.keys(ref.holderKinds)) expect(holders).toContain(`<span class="item-id">${kind}</span>`);
    const howTo = site.get('loot/how-to-read.html')!;
    for (const n of ref.probability) expect(howTo).toContain(`id="def-${slug(n.id)}"`);
    // The test-only reduced-food profile is never presented as a level.
    expect([...site.keys()].some(p => /reduced/i.test(p))).toBe(false);
  });

  it('labels conditional shares with their denominators and never claims a per-level chance to find an item', () => {
    for (const t of Object.values(ref.tables).filter(x => !x.emptyTable).slice(0, 40)) {
      const page = [...site.values()].find(h => h.includes(`<dt>Stable id</dt><dd><code>${t.id.replace(/&/g, '&amp;')}</code>`))!;
      expect(page).toContain(`denominator ${num(t.denominator)}`);
      for (const r of t.rows) expect(page).toContain(`<span class="denom">${num(r.weight)} / ${num(t.denominator)}</span>`);
    }
    // Only the "What this site never states" section of How to read may mention such a chance (to say it is never given).
    const claims = (p: string) => site.get(p)!.replace(/<section id="not-stated">[\s\S]*?<\/section>/, '');
    for (const p of pages()) expect(claims(p), p).not.toMatch(/chance (?:to|of) find(?:ing)? [^<]{0,40} in (?:the|this|a) level/i);
    expect(site.get('loot/how-to-read.html')).toContain('<section id="not-stated">');
  });

  it('uses relative links only, so it works under /terminal-state/, any sub-path and file://', () => {
    expect(site.get('loot/tables/index.html')).toContain('href="../../assets/site.css"');
    expect(site.get('index.html')).toContain('href="assets/site.css"');
    for (const p of pages()) {
      const html = site.get(p)!;
      expect(html, p).not.toMatch(/\s(?:href|src)="\//);
      expect(html, p).not.toMatch(/\s(?:href|src)="https?:\/\/(?!github\.com\/BenjaminBenetti\/terminal-state\/)/);
    }
    expect(href('loot/tables/a.html', 'assets/site.css')).toBe('../../assets/site.css');
    expect(href('index.html', 'loot/index.html#levels')).toBe('loot/index.html#levels');
    expect(href('loot/a.html', 'loot/a.html#k')).toBe('#k');
    expect(href('loot/office/index.html', 'loot/subway/floor.html')).toBe('../subway/floor.html');
  });

  it('keeps the client script and the filter UI progressive (everything visible without JavaScript)', () => {
    for (const p of pages()) {
      for (const m of site.get(p)!.matchAll(/<div class="filter"[^>]*>/g)) expect(m[0]).toContain(' hidden');
    }
    const js = site.get('assets/site.js')!;
    expect(js).not.toMatch(/\bfetch\b|localStorage|innerHTML/);
  });

  it('client filter: hides non-matching rows / empty groups, opens matching <details>, restores on clear (DOM stub)', () => {
    // A minimal element stub with just the selectors site.js uses; no browser.
    class El {
      hidden = false;
      open = false;
      value = '';
      textContent = '';
      parentElement: El | null = null;
      children: El[] = [];
      listeners: Record<string, (e: unknown) => void> = {};
      constructor(public tagName: string, public attrs: Record<string, string> = {}, kids: El[] = []) {
        for (const k of kids) this.append(k);
      }
      append(k: El) { k.parentElement = this; this.children.push(k); return k; }
      getAttribute(n: string) { return n in this.attrs ? this.attrs[n]! : null; }
      addEventListener(t: string, f: (e: unknown) => void) { this.listeners[t] = f; }
      all(): El[] { return this.children.flatMap(c => [c, ...c.all()]); }
      matches(sel: string): boolean {
        const m = /^([a-z]*)(?:\[([\w-]+)\])?(:not\(\[hidden\]\))?$/i.exec(sel)!;
        return (!m[1] || this.tagName === m[1].toUpperCase()) && (!m[2] || m[2] in this.attrs) && (!m[3] || !this.hidden);
      }
      querySelectorAll(sel: string) { return this.all().filter(e => e.matches(sel)); }
      querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
      closest(sel: string): El | null { return this.matches(sel) ? this : this.parentElement?.closest(sel) ?? null; }
    }
    const row = (text: string, tag = 'TR') => Object.assign(new El(tag, {'data-filter-row': '', 'data-search': text}), {textContent: text});
    const r1 = row('bandage medicine');
    const r2 = row('water drink');
    const d1 = row('kitchen fridge water', 'DETAILS');
    const group = new El('SECTION', {'data-filter-group': ''}, [r1]);
    const target = new El('DIV', {id: 'list'}, [group, r2, d1]);
    const input = new El('INPUT');
    const status = new El('SPAN', {'data-filter-status': ''});
    const box = new El('DIV', {'data-filter': 'list', 'data-filter-noun': 'rows'}, [input, status]);
    box.hidden = true;
    const root = new El('BODY', {}, [box, target]);
    const document = {
      readyState: 'complete',
      querySelectorAll: (sel: string) => root.querySelectorAll(sel),
      getElementById: (id: string) => root.all().find(e => e.attrs.id === id) ?? null,
      addEventListener: () => undefined,
    };
    const window = {location: {search: '', hash: ''}, addEventListener: () => undefined};
    vm.runInNewContext(site.get('assets/site.js')!, {document, window, URLSearchParams, decodeURIComponent});
    expect(box.hidden).toBe(false);
    expect(status.textContent).toBe('3 rows');
    input.value = 'Water';
    input.listeners.input!({});
    expect([r1.hidden, r2.hidden, d1.hidden]).toEqual([true, false, false]);
    expect(group.hidden).toBe(true);
    expect(d1.open).toBe(true);
    expect(status.textContent).toBe('2 of 3 rows match');
    input.value = '';
    input.listeners.input!({});
    expect([r1.hidden, r2.hidden, d1.hidden, group.hidden, d1.open]).toEqual([false, false, false, false, false]);
  });

  it('formats numbers without rounding a non-zero value to zero or a non-certain one to 100 %', () => {
    expect(pct(0)).toBe('0%');
    expect(pct(1)).toBe('100%');
    expect(pct(0.000001)).toBe('&lt;0.01%');
    expect(pct(0.999999)).toBe('&gt;99.99%');
    expect(pct(0.5)).toBe('50%');
    expect(pct(0.0094)).toBe('0.94%');
    expect(num(0.0004)).toBe('&lt;0.001');
    expect(num(2.5)).toBe('2.5');
    expect(() => pct(Number.NaN)).toThrow();
    expect(() => num(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('enemy spawns section', () => {
  const levelPage = (id: string) => `enemies/${slug(id)}.html`;
  const enemyPages = () => [...site.keys()].filter(p => p.startsWith('enemies/'));
  /** Page text without the "What these pages never state" section (the only place allowed to name what is not stated). */
  const claims = (p: string) => site.get(p)!.replace(/<section id="not-stated">[\s\S]*?<\/section>/, '');
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  it('is linked from the landing page and from the site navigation of every page', () => {
    expect(NAV.map(n => n.path)).toContain('enemies/index.html');
    const landing = site.get('index.html')!;
    expect(landing).toContain('href="enemies/index.html"');
    for (const level of enemyRef.levels) expect(landing).toContain(`href="${levelPage(level.id)}"`);
    for (const p of pages()) {
      const nav = /<nav class="site-nav" aria-label="Site">([\s\S]*?)<\/nav>/.exec(site.get(p)!)![1]!;
      expect(nav, p).toContain(`href="${href(p, 'enemies/index.html')}"`);
      expect(nav, p).toContain(`href="${href(p, 'loot/index.html')}"`);
    }
    for (const p of enemyPages()) expect(site.get(p)!, p).toMatch(/<a href="index\.html" aria-current="(?:page|true)">Enemy spawns<\/a>/);
  });

  it('has the overview, families, how-to-read and one page per registered level, and nothing else under enemies/', () => {
    const expected = ['enemies/index.html', 'enemies/families.html', 'enemies/how-to-read.html', ...enemyRef.levels.map(l => levelPage(l.id))].sort();
    expect(enemyPages().sort()).toEqual(expected);
    expect(enemyRef.levels.map(l => l.id)).toEqual(expect.arrayContaining(['subway', 'office', 'mall']));
    const index = site.get('enemies/index.html')!;
    for (const level of enemyRef.levels) expect(index).toContain(`href="${slug(level.id)}.html"`);
    expect(site.get('data/enemies.json')!.endsWith('\n')).toBe(true);
  });

  it('renders every context with its exact count range and E[count], every family share with its denominator', () => {
    for (const level of enemyRef.levels) {
      const html = site.get(levelPage(level.id))!;
      // (task track3-eaton-centre-20261031: "The Eaton's Center" — the renderer escapes the apostrophe too)
      expect(html).toContain(`<h1>${level.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}: enemy spawns</h1>`);
      for (const c of level.contexts) {
        expect(html, c.id).toContain(`id="ctx-${slug(c.id)}"`);
        expect(html, c.id).toContain(`${range(c.count.lo, c.count.hi)}<span class="denom">U{${num(c.count.lo)}..${num(c.count.hi)}}</span>`);
        expect(html, c.id).toContain(`<td class="num">${num(c.count.mean)}</td>`);
        expect(c.count.mean).toBe((c.count.lo + c.count.hi) / 2);
      }
      expect(html).toContain(`<strong>${range(level.total.lo, level.total.hi)}</strong>`);
      const den = level.pool.denominator;
      expect(html).toContain(`denominator ${num(den)}`);
      for (const r of level.pool.rows) {
        expect(html, r.family).toContain(`<tr id="family-${slug(r.family)}">`);
        expect(html, r.family).toContain(`<span class="denom">${num(r.weight)} / ${num(den)}</span>`);
        expect(r.share).toBeCloseTo(r.weight / den, 12);
      }
      for (const f of enemyRef.families) expect(html, f.id).toContain(`id="family-${slug(f.id)}"`);
      // Zombie types are a zombie sub-distribution, never presented as families.
      expect(html).toContain('<h2 id="zombie-types">Zombie types <span class="summary-meta">(inside the zombie family)</span></h2>');
      expect(html).toContain('Not separate enemy families.');
      for (const t of level.zombieTypes.types) expect(enemyRef.families.some(f => f.id === t.type)).toBe(false);
    }
    const families = site.get('enemies/families.html')!;
    for (const f of enemyRef.families) expect(families).toContain(`<section id="family-${slug(f.id)}">`);
  });

  it('shows the baseline placement rules and the room modifier table (all 1× today; missing = 1×)', () => {
    for (const level of enemyRef.levels) {
      const html = site.get(levelPage(level.id))!;
      expect(html).toContain('<h2 id="placement">Baseline placement rules</h2>');
      for (const c of level.contexts) {
        const pl = c.placement;
        // Each context either renders its own rules or names the earlier context with identical values.
        const own = html.includes(`${level.name} · ${c.label}: area weights`);
        if (own) {
          for (const r of pl.areaWeights.rules) expect(html, `${c.id} ${r.match}`).toContain(`<td class="num">${num(r.weight)}</td>`);
          expect(html).toContain(`at least ${num(pl.spacing.metres)} m between spawns`);
          expect(html).toContain(`${num(pl.triesPerArea)} random eligible cell`);
        } else {
          const rules = (x: typeof pl) => JSON.stringify({...x, explanation: []});
          expect(level.contexts.some(o => o !== c && rules(o.placement) === rules(pl))).toBe(true);
        }
        // Each context keeps its own walk-through (it names that context's count range).
        for (const e of pl.explanation) expect(html, c.id).toContain(`<li>${prose(e)}</li>`);
      }
      expect(html).toContain('<h2 id="rooms">Room modifiers</h2>');
      expect(html).toContain('A room key or family without an entry resolves to\n1×');
      for (const r of level.rooms.rows) {
        expect(html, r.room).toContain(`id="room-${slug(r.room)}"`);
        // Shipped defaults are neutral: every resolved value is exactly 1.
        expect(r.intensity, r.room).toBe(1);
        for (const f of r.families) expect([f.density, f.weight, f.from], `${r.room} ${f.family}`).toEqual([1, 1, 'default']);
      }
      expect(level.rooms.entries).toEqual([]);
      expect(html).toContain('resolve to 1× for every family (neutral)');
      expect(html).toContain('no explicit room modifier entries');
    }
    const howTo = site.get('enemies/how-to-read.html')!;
    for (const v of enemyRef.vocabulary) expect(howTo, v.term).toContain(`id="term-${slug(v.term)}"`);
    for (const f of enemyRef.modifiers.fields) expect(howTo).toContain(`<span class="item-id">${f.field}</span>`);
    expect(howTo).toContain('<section id="not-stated">');
  });

  it('labels every density as sampled over eligible floor of a named corpus and never states a per-area rate as a rule', () => {
    for (const p of enemyPages()) {
      const html = claims(p);
      expect(html, p).not.toMatch(/square f(?:oo|ee)t|\bsq\.? ?ft\b|per (?:square )?foot/i);
      for (const m of html.matchAll(/<th scope="col"[^>]*>([^<]*100 m²[^<]*)<\/th>/g)) expect(m[1], p).toMatch(/\(sampled\)/);
    }
    for (const level of enemyRef.levels) {
      const html = site.get(levelPage(level.id))!;
      if (!level.census) {
        expect(html).toContain('contains no sampled census');
        continue;
      }
      expect(html).toContain('<span class="badge badge-info">sampled</span> <strong>Observed, not a rule.</strong>');
      expect(html).toContain(level.census.seeds.join(', '));
      expect(html).toContain('not the map\'s bounding');
    }
  });

  it('shows source locations as private-repository links and the build identity like the loot pages', () => {
    for (const level of enemyRef.levels) {
      const html = site.get(levelPage(level.id))!;
      expect(html).toContain('<h2 id="knobs">Where to tune it</h2>');
      expect(html).toContain(`github.com/BenjaminBenetti/terminal-state/blob/${COMMIT}/${level.profile.at.file}`);
    }
  });

  it('shows a new level, context, family and room key automatically (coverage)', () => {
    const lootRef = clone(ref);
    const base = clone(enemyRef);
    const lvl = base.levels[0]!;
    const fam = {...base.families[0]!, id: 'test-family', label: 'Test family', levels: ['test-level']};
    const ctx = {...lvl.contexts[0]!, id: 'test-context', label: 'Test context'};
    const room = {...lvl.rooms.rows[0]!, room: 'test-room', label: 'Test room'};
    const level: EnemyLevelInfo = {
      ...lvl,
      id: 'test-level',
      name: 'Test level',
      contexts: [...lvl.contexts, ctx],
      rooms: {...lvl.rooms, rows: [...lvl.rooms.rows, room]},
    };
    const next: EnemyReference = {...base, families: [...base.families, fam], levels: [...base.levels, level]};
    const out = renderSite(lootRef, next);
    expect(validateSite(out)).toEqual([]);
    const page = out.get('enemies/test-level.html')!;
    expect(page).toBeDefined();
    for (const id of ['ctx-test-context', 'room-test-room', 'family-test-family']) expect(page).toContain(`id="${id}"`);
    expect(out.get('enemies/families.html')).toContain('<section id="family-test-family">');
    expect(out.get('enemies/index.html')).toContain('href="test-level.html"');
    expect(out.get('index.html')).toContain('href="enemies/test-level.html"');
  });

  it('fails the build for unknown kinds or references the reference does not register', () => {
    const lootRef = clone(ref);
    const withLevel = (patch: (l: EnemyLevelInfo) => EnemyLevelInfo): EnemyReference => {
      const base = clone(enemyRef);
      return {...base, levels: [patch(base.levels[0]!), ...base.levels.slice(1)]};
    };
    expect(() => renderSite(lootRef, withLevel(l => ({...l, rooms: {...l.rooms, rows: [{...l.rooms.rows[0]!, keyKind: 'mystery' as 'purpose'}]}}))))
      .toThrow(/Unlabelled room key kind mystery/);
    expect(() => renderSite(lootRef, withLevel(l => ({...l, pool: {...l.pool, rows: [...l.pool.rows, {family: 'ghoul', weight: 1, share: 0.1}]}}))))
      .toThrow(/enemy family "ghoul"/);
    expect(() => renderSite(lootRef, withLevel(l => ({...l, zombieTypes: {...l.zombieTypes, expectedCoated: [{context: 'nowhere', count: 2, share: 0.5}]}}))))
      .toThrow(/context "nowhere"/);
    expect(() => renderSite(lootRef, withLevel(l => ({...l, id: 'families'})))).toThrow(/collides with reserved page/);
    expect(() => renderSite(lootRef, {...clone(enemyRef), meta: {...enemyRef.meta, schema: 999}})).toThrow(/schema/);
    expect(() => renderSite(lootRef, {...clone(enemyRef), modifiers: {...enemyRef.modifiers, fields: [{...enemyRef.modifiers.fields[0]!, field: 'speed' as 'density'}]}}))
      .toThrow(/Unlabelled room modifier field speed/);
  });
});

describe('reference site validator rejects unsafe or broken output', () => {
  const page = 'loot/index.html';
  const withText = (extra: string) => mutated(page, site.get(page)!.replace('</main>', `${extra}</main>`));
  const cases: Array<[string, () => Map<string, string>, RegExp]> = [
    ['a source map', () => mutated('assets/site.js.map', '{}'), /allowlist/],
    ['TypeScript source', () => mutated('loot/x.ts', 'export const x = 1;'), /allowlist/],
    ['a game asset', () => mutated('assets/models/x.glb', 'x'), /allowlist/],
    ['a dotfile', () => mutated('.env', 'A=1'), /allowlist/],
    ['a workspace path', () => withText('<p>/workspaces/subway-game/game/src</p>'), /workstation path/],
    ['reference/ task material', () => withText('<p>see reference/tasks/x/REPORT.md</p>'), /reference\//],
    ['a token', () => withText(`<p>ghp_${'a'.repeat(36)}</p>`), /GitHub token/],
    ['a broken link', () => withText('<a href="nowhere.html">x</a>'), /broken link/],
    ['a broken fragment', () => withText('<a href="index.html#nope">x</a>'), /broken fragment/],
    ['a root-absolute link', () => withText('<a href="/terminal-state/index.html">x</a>'), /root-absolute/],
    ['an external link', () => withText('<a href="https://example.com/">x</a>'), /external URL/],
    ['an unlabelled repository link', () => withText('<a href="https://github.com/BenjaminBenetti/terminal-state/blob/main/x.ts">x</a>'), /external URL/],
    ['an inline script', () => withText('<script>alert(1)</script>'), /inline script/],
    ['an event handler', () => withText('<p onclick="x()">x</p>'), /event handler/],
    ['a table without caption', () => withText('<table><tr><th>a</th></tr></table>'), /caption/],
    ['a rendering artifact', () => withText('<p>NaN units</p>'), /rendering artifact/],
    ['an unescaped "<"', () => withText('<p><0.01%</p>'), /unescaped/],
    ['a non-finite JSON number', () => mutated('data/loot.json', '{"x": 1e999}'), /non-finite|manifest/],
    ['a stale manifest', () => mutated('assets/site.css', `${site.get('assets/site.css')}\n/* changed */\n`), /manifest/],
    ['a network call in the script', () => mutated('assets/site.js', 'fetch("x");'), /network access|manifest/],
    ['a page whose nav misses Enemy spawns', () => mutated(page, site.get(page)!.replace('<li><a href="../enemies/index.html">Enemy spawns</a></li>', '')), /site navigation does not link to enemies\/index\.html/],
    ['an enemy page without a level', () => mutated('enemies/ghost.html', site.get('enemies/families.html')!), /enemy page without a level/],
    ['an enemy path outside the allowlist', () => mutated('enemies/x/y.html', site.get('enemies/families.html')!), /allowlist/],
    ['a level page missing a context anchor', () => {
      const level = enemyRef.levels[0]!;
      const file = `enemies/${slug(level.id)}.html`;
      return mutated(file, site.get(file)!.replace(`id="ctx-${slug(level.contexts[0]!.id)}"`, 'id="ctx-gone"'));
    }, /no rendered place for context/],
    ['a level page missing a room key anchor', () => {
      const level = enemyRef.levels.find(l => l.rooms.rows.length)!;
      const file = `enemies/${slug(level.id)}.html`;
      return mutated(file, site.get(file)!.replace(`id="room-${slug(level.rooms.rows[0]!.room)}"`, 'id="room-gone"'));
    }, /no rendered place for room key/],
    // task track3-eaton-centre-20261031 (lane PROFILES / INTEG): the mall's horde pool and every eligibility rule (the mall's Siren with
    // its whole-level spacing) must have their places
    ['a level page missing its horde section', () => {
      const level = enemyRef.levels.find(l => l.horde)!;
      const file = `enemies/${slug(level.id)}.html`;
      return mutated(file, site.get(file)!.replace('id="horde"', 'id="horde-gone"'));
    }, /no rendered place for horde pool/],
    ['a level page missing an eligibility rule anchor (the mall Siren)', () => {
      const level = enemyRef.levels.find(l => l.id === 'mall')!;
      const file = `enemies/${slug(level.id)}.html`;
      return mutated(file, site.get(file)!.replace(`id="elig-${slug(level.pool.eligibility[0]!.family)}"`, 'id="elig-gone"'));
    }, /no rendered place for eligibility rule mall\/siren/],
    ['enemy data that the manifest digest does not name', () => {
      const data = JSON.parse(site.get('data/enemies.json')!) as EnemyReference;
      return mutated('data/enemies.json', `${JSON.stringify({...data, meta: {...data.meta, dataHash: 'ffffffff'}})}\n`);
    }, /enemyDataHash does not match data\/enemies\.json/],
  ];
  it.each(cases)('rejects %s', (_label, make, expected) => {
    const problems = validateSite(make());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(expected);
  });
});

describe('build plumbing', () => {
  it('writes only dist/pages/ and leaves the game build and CI artifact alone', () => {
    expect(OUTPUT_DIR).toBe('dist/pages');
    const gameVite = fs.readFileSync(path.join(ROOT, 'game/vite.config.ts'), 'utf8');
    expect(gameVite).toContain("'../dist/game'");
    const packager = fs.readFileSync(path.join(ROOT, 'tools/release/package-ci.mjs'), 'utf8');
    expect(packager).not.toMatch(/dist\/pages|tools\/pages/);
    const pagesVite = fs.readFileSync(path.join(ROOT, 'tools/pages/vite.config.ts'), 'utf8');
    expect(pagesVite).toContain("'../../node_modules/.cache/terminal-state-pages'");
    expect(pagesVite).toMatch(/envDir: false/);
  });

  it('renders only from the LootReference / EnemyReference objects (no renderer imports game modules)', () => {
    const dir = path.join(ROOT, 'tools/pages/render');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(/from\s+'([^']+)'/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(/^(?:\.\/|\.\.\/(?:lootReferenceTypes|enemyReferenceTypes|validate|assets\/site\.(?:css|js)\?raw)$|node:)/);
    }
  });

  it('resolves the source commit without needing Git history', () => {
    expect(resolveCommit(ROOT, {GITHUB_SHA: COMMIT.toUpperCase()})).toBe(COMMIT);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-commit-'));
    try {
      expect(resolveCommit(tmp, {GITHUB_SHA: 'not-a-sha'})).toBe('local');
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  });

  it('confines the source reader to game sources and docs', () => {
    const read = sourceReader(ROOT);
    expect(read('game/src/items/lootTables.ts')).toContain('export');
    for (const bad of ['../etc/passwd', '.env', 'game/src/../../.git/config', 'reference/tasks/x.md', '/etc/hosts', 'package.json']) {
      expect(read(bad), bad).toBeNull();
    }
  });
});
