// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE RECIPE LIST of the crafting bench (ui/craftView.ts) — its rows,
// the markup, the key scope and the thin DOM shell (on the tiny fake DOM). The bench that opens it is tests/craft-bench.test.ts.
// Task train-interaction-ux-20261112-063646 (lane CRAFT-UI): no crafting shortcuts or their labels; a preview frame on the left of
// each row (empty here: Node has no renderer — the rendered picture is tests/craft-preview.test.ts); materials as inventory icons with
// have / need ratios, green or red exactly as the craft's own plan decides (the helper's invariant: tests/craft-needs.test.ts); one
// short line of text per recipe, a refusal sentence only from the equipment system.
import {afterEach, describe, expect, it} from 'vitest';
import {
  CRAFT_VIEW_ID, CRAFT_VIEW_TEXT, CraftView, craftKeyAction, craftModel, craftNeedHtml, craftPreviewHtml, craftPreviewId, craftRowsHtml, craftViewHtml,
  whereFromText, type CraftViewModel,
} from '../src/ui/craftView';
import {countMaterials, craftSources, planCraft, type MaterialSource} from '../src/craft/crafting';
import {EQUIPMENT, type EquipmentKind} from '../src/craft/equipment';
import {RECIPES, RECIPE_MATERIALS} from '../src/craft/recipes';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {Inventory} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {TrainLockbox} from '../src/run/trainLockbox';
import {itemIconHtml, itemIconUrl} from '../src/ui/itemIcons';
import {fakeStore} from './helpers/craftBenchFakes';
import {installFakeDom, type FakeDom, type FakeEl} from './helpers/fakeDom';

/** Sources as the bench would hand them over: scrap 3 carried + 4 Lockbox, electrical 1 backpack + 2 chests. */
function sources(): MaterialSource[] {
  const inv = new Inventory(), box = new TrainLockbox(), chest = fakeStore('eq-1');
  inv.add(inv.makeStack(SCRAP_METAL, 3));
  const bag = inv.makeStack('backpack', 1);
  inv.wearBag(bag);
  bag.bag![0] = inv.makeStack(ELECTRICAL_PARTS, 1);
  box.slots[0] = inv.makeStack(SCRAP_METAL, 4);
  chest.slots[0] = inv.makeStack(ELECTRICAL_PARTS, 2);
  return craftSources({inv, lockbox: box, stores: [chest]});
}
const free = () => null;
const SCRAP = itemDef(SCRAP_METAL).name, ELEC = itemDef(ELECTRICAL_PARTS).name;

describe('craft view: texts', () => {
  it('where a count is: only the places that hold some; nothing in reach says where the bench looks', () => {
    expect(whereFromText({carried: 3, backpack: 0, lockbox: 4, chests: 0})).toBe('3 carried · 4 in the Lockbox');
    expect(whereFromText({carried: 0, backpack: 1, lockbox: 0, chests: 2})).toBe('1 in your backpack · 2 in chests');
    expect(whereFromText({carried: 1, backpack: 2, lockbox: 3, chests: 4})).toBe('1 carried · 2 in your backpack · 3 in the Lockbox · 4 in chests');
    expect(whereFromText({carried: 0, backpack: 0, lockbox: 0, chests: 0})).toBe(CRAFT_VIEW_TEXT.nowhere);
    const c = countMaterials(sources());
    expect(whereFromText(c[SCRAP_METAL])).toBe('3 carried · 4 in the Lockbox');
    expect(whereFromText(c[ELECTRICAL_PARTS])).toBe('1 in your backpack · 2 in chests');
  });

  it('the wording is short: no crafting shortcut, no repeated instructions, one sentence per recipe', () => {
    expect(CRAFT_VIEW_TEXT).toEqual({
      title: 'Crafting bench', live: '● Not paused — keep an eye out', craft: 'Craft', close: 'Close (E)',
      nowhere: 'None on you, in the Lockbox or in a chest in the car',
    });
    for (const r of RECIPES) {
      expect(r.blurb.length, r.kind).toBeLessThanOrEqual(90);
      expect(r.blurb.match(/[.!?]/g), r.kind).toHaveLength(r.blurb.includes('5.56mm') ? 2 : 1); // one sentence ("5.56mm" has the only other dot)
      expect(r.blurb.endsWith('.'), r.kind).toBe(true);
    }
    // (the release packaging check refuses bundled text that starts like a root-absolute URL: none of the view's texts does)
    for (const t of [...Object.values(CRAFT_VIEW_TEXT), ...RECIPES.map(r => r.blurb)]) expect(t).not.toMatch(/^\/[^\s/]/);
  });
});

describe('craft view: the model', () => {
  it('one row per recipe in RECIPES order: the unit name, the blurb, its preview id, a chip per material it costs', () => {
    const m = craftModel(sources(), free);
    expect(m.rows.map(r => [r.kind, r.name, r.preview])).toEqual([
      ['chest', 'Storage chest', 'equipment:chest'], ['radar', 'Route radar', 'equipment:radar'], ['sentry', 'Defense sentry', 'equipment:sentry'],
      ['scanner', 'Item scanner', 'equipment:scanner'],
    ]);
    m.rows.forEach((r, i) => {
      expect(r.name).toBe(EQUIPMENT[RECIPES[i].kind].name);
      expect(r.blurb).toBe(RECIPES[i].blurb);
      expect(r.preview).toBe(craftPreviewId(RECIPES[i].kind));
      // only the materials the recipe costs (the chest costs no electrical parts: no chip for them)
      expect(r.needs.map(n => n.material)).toEqual(RECIPE_MATERIALS.filter(id => RECIPES[i].cost[id] > 0));
      for (const n of r.needs) expect(n.need).toBe(RECIPES[i].cost[n.material]);
    });
    // scrap 7, electrical 3: the chest (2 / 0) and the radar (4 / 3) can be made; the sentry (8 / 6) and the scanner (5 / 5) cannot
    expect(m.rows.map(r => r.needs.map(n => [n.have, n.need, n.state]))).toEqual([
      [[7, 2, 'ok']],
      [[7, 4, 'ok'], [3, 3, 'ok']],
      [[7, 8, 'short'], [3, 6, 'short']],
      [[7, 5, 'ok'], [3, 5, 'short']],
    ]);
    expect(m.rows[1].needs.map(n => [n.name, n.where])).toEqual([[SCRAP, '3 carried · 4 in the Lockbox'], [ELEC, '1 in your backpack · 2 in chests']]);
    expect(m.rows.map(r => r.can)).toEqual([true, true, false, false]);
    // a shortage is the red ratio: no sentence
    expect(m.rows.map(r => r.reason)).toEqual(['', '', '', '']);
    expect(Object.keys(m)).toEqual(['rows']); // (no totals footer)
  });

  it('the button follows the craft\'s own plan and the equipment system: can = planCraft finds a plan AND no refusal', () => {
    const block = (k: EquipmentKind) => (k === 'chest' ? 'No room on the car floor — move something first' : k === 'sentry' ? 'Too much equipment in the car (24 of 24) — leave some at a station' : null);
    const src = sources(), m = craftModel(src, block);
    expect(m.rows.map(r => r.can)).toEqual([false, true, false, false]);
    RECIPES.forEach((r, i) => expect(m.rows[i].can, r.kind).toBe(planCraft(r, src).ok && !block(r.kind)));
    expect(m.rows[0].reason).toBe('No room on the car floor — move something first'); // (materials are there: only the refusal)
    expect(m.rows[0].needs.map(n => n.state)).toEqual(['ok']);
    expect(m.rows[2].reason).toBe('Too much equipment in the car (24 of 24) — leave some at a station');
    expect(m.rows[2].needs.map(n => n.state)).toEqual(['short', 'short']); // ... while its ratios still say what is short
    expect(m.rows[3].reason).toBe(''); // short only: no sentence
  });

  it('nothing at all: every chip is short at 0, no row can be crafted, no sentences', () => {
    const m = craftModel(craftSources({inv: new Inventory()}), free);
    expect(m.rows.map(r => r.can)).toEqual([false, false, false, false]);
    expect(m.rows.map(r => r.reason)).toEqual(['', '', '', '']);
    for (const r of m.rows) for (const n of r.needs) expect([n.have, n.state, n.where]).toEqual([0, 'short', CRAFT_VIEW_TEXT.nowhere]);
  });
});

describe('craft view: the markup', () => {
  it('a row: the preview frame on the LEFT, the name + one line, the material chips, the Craft button', () => {
    const m = craftModel(sources(), free);
    const html = craftRowsHtml(m);
    expect(html.match(/<div class="cv-row /g)?.length).toBe(4);
    // Node has no renderer, so no preview is cached: the frame is EMPTY (never a glyph, a stand-in or another proxy picture)
    for (const r of m.rows) expect(itemIconUrl(r.preview), r.kind).toBeNull();
    expect(craftPreviewHtml('equipment:chest')).toBe('<div class="cv-preview cv-empty"></div>');
    expect(html).toContain('<div class="cv-row cv-can" data-kind="chest"><div class="cv-preview cv-empty"></div><div class="cv-what"><b class="cv-name">Storage chest</b>'
      + `<div class="cv-blurb">${RECIPES[0].blurb}</div></div><div class="cv-mats">`);
    // the order inside every row: preview, text, materials, button
    for (const row of html.split('<div class="cv-row ').slice(1)) {
      const at = ['cv-preview', 'cv-what', 'cv-mats', 'cv-do'].map(c => row.indexOf(`<div class="${c}`));
      expect(at.every(i => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(row.indexOf('<div class="cv-preview')).toBe(row.indexOf('>') + 1); // the row's first child
    }
    expect(html).toContain('<div class="cv-do"><button class="cv-craft primary" type="button" data-kind="chest">Craft</button></div></div>');
    expect(html).toContain('<div class="cv-row cv-cant" data-kind="sentry">');
    expect(html).toContain('<button class="cv-craft primary" type="button" data-kind="sentry" disabled>Craft</button></div></div>'); // short: disabled, no sentence
    expect(html).not.toContain('cv-why');
  });

  it('a material chip: the inventory icon of the material + have / need, green (ok) or red (short); the name and where in its tooltip', () => {
    const m = craftModel(sources(), free);
    const [scrap, elec] = m.rows[3].needs; // the scanner: 5 / 5 against scrap 7, electrical 3
    expect(craftNeedHtml(scrap)).toBe(`<span class="cv-mat ok" data-material="scrap_metal" role="img" aria-label="${SCRAP}: 7 of 5" data-tip="${SCRAP}"`
      + ` data-tip-body="Have 7 · need 5\n3 carried · 4 in the Lockbox">${itemIconHtml(SCRAP_METAL)}<span class="cv-ratio">7 / 5</span></span>`);
    expect(craftNeedHtml(elec)).toBe(`<span class="cv-mat short" data-material="electrical_parts" role="img" aria-label="${ELEC}: 3 of 5" data-tip="${ELEC}"`
      + ` data-tip-body="Have 3 · need 5\n1 in your backpack · 2 in chests" data-tip-tone="danger">${itemIconHtml(ELECTRICAL_PARTS)}<span class="cv-ratio">3 / 5</span></span>`);
    // the icon is the inventory's own for that material (its rendered model in the game; here, without a renderer, its SVG glyph)
    expect(itemIconHtml(SCRAP_METAL).startsWith('<svg')).toBe(true);
    expect(itemIconHtml(SCRAP_METAL)).not.toBe(itemIconHtml(ELECTRICAL_PARTS));
    const html = craftRowsHtml(m);
    // per row exactly the chips of the materials it costs, in order, with the plan's classes; no material name is written in a row
    const rows = html.split('<div class="cv-row ').slice(1);
    rows.forEach((row, i) => {
      const chips = [...row.matchAll(/<span class="cv-mat (ok|short)" data-material="([a-z_]+)"/g)].map(x => [x[2], x[1]]);
      expect(chips, RECIPES[i].kind).toEqual(m.rows[i].needs.map(n => [n.material, n.state]));
      const text = row.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ' ');
      expect(text).not.toContain(SCRAP);
      expect(text).not.toContain(ELEC);
      expect(text).not.toMatch(/have|need|more|carried|Lockbox/i);
    });
    expect(rows[0].match(/cv-mat /g)).toHaveLength(1); // the chest costs scrap only
  });

  it('exactly per the plan: all chips green and the button on <=> the craft would go through', () => {
    const stocks: [number, number][] = [[0, 0], [2, 0], [1, 9], [4, 3], [4, 2], [8, 6], [7, 6], [8, 5], [5, 5], [99, 99]];
    for (const [scrap, elec] of stocks) {
      const inv = new Inventory();
      if (scrap) inv.add(inv.makeStack(SCRAP_METAL, scrap));
      if (elec) inv.add(inv.makeStack(ELECTRICAL_PARTS, elec));
      const src = craftSources({inv}), rows = craftRowsHtml(craftModel(src, free)).split('<div class="cv-row ').slice(1);
      RECIPES.forEach((r, i) => {
        const ok = planCraft(r, src).ok, tag = `${r.kind} @ ${scrap}/${elec}`;
        expect(rows[i].startsWith(ok ? 'cv-can"' : 'cv-cant"'), tag).toBe(true);
        expect(!rows[i].includes('class="cv-mat short"'), tag).toBe(ok);
        expect(rows[i].includes(' disabled>Craft</button>'), tag).toBe(!ok);
      });
    }
  });

  it('only the equipment system\'s refusal is a sentence: on its own line under the row, escaped', () => {
    const m = craftModel(sources(), k => (k === 'radar' ? 'No room <on> the "car" floor & more' : null));
    const html = craftRowsHtml(m);
    expect(html).toContain('<div class="cv-row cv-cant" data-kind="radar">');
    expect(html).toContain('<button class="cv-craft primary" type="button" data-kind="radar" disabled>Craft</button></div>'
      + '<div class="cv-why">No room &lt;on&gt; the &quot;car&quot; floor &amp; more</div></div>');
    expect(html.match(/cv-why/g)).toHaveLength(1);
  });

  it('no shortcut labels anywhere: no number keys, no "Craft (n)", no key hints for crafting', () => {
    const m = craftModel(sources(), k => (k === 'chest' ? 'No room on the car floor — move something first' : null));
    const panel = craftViewHtml(m, 'Crafted: Route radar — hold E to drag it to a free plug', false);
    expect(panel).not.toContain('cv-key');
    expect(panel).not.toMatch(/Craft\s*\(/);
    expect([...panel.matchAll(/<button class="cv-craft[^>]*>([^<]*)<\/button>/g)].map(x => x[1])).toEqual(['Craft', 'Craft', 'Craft', 'Craft']);
    const text = panel.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '\n');
    expect(text).not.toMatch(/press|1\s*[–-]\s*4|\bkeys?\b|click/i);
    // the only key named is the standard close
    expect([...text.matchAll(/\(([A-Za-z0-9])\)/g)].map(x => x[1])).toEqual(['E']);
  });

  it('the panel: the title, the not-paused line, the rows, the note beside Close — no help line, no totals', () => {
    const m = craftModel(sources(), free);
    const html = craftViewHtml(m, 'Crafted: Route radar — hold E to drag it to a free plug', false);
    expect(html).toContain('<b class="cv-title">Crafting bench</b><span class="cv-live">● Not paused — keep an eye out</span>');
    expect(html).toContain(`<div class="cv-list">${craftRowsHtml(m)}</div>`);
    expect(html).toContain('<div class="cv-actions"><div class="cv-note" role="status">Crafted: Route radar — hold E to drag it to a free plug</div><button class="cv-close" type="button">Close (E)</button></div>');
    expect(craftViewHtml(m, 'No', true)).toContain('<div class="cv-note refused" role="status">No</div>');
    expect(craftViewHtml(null)).toContain('<div class="cv-list"></div><div class="cv-actions">');
    for (const gone of ['cv-help', 'cv-foot', 'cv-total', 'cv-cost']) expect(html).not.toContain(gone);
    expect((html.match(/Not paused/g) ?? []).length).toBe(1); // said once
  });
});

describe('craft view: keys', () => {
  const key = (code: string, o: Partial<{repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; target: unknown}> = {}) => ({code, target: {tagName: 'BODY'}, ...o});
  const DIGITS = [...'0123456789'].flatMap(d => [`Digit${d}`, `Numpad${d}`]);

  it('closed, or typing in a field: nothing is the view\'s', () => {
    for (const code of ['KeyE', 'Escape', 'Tab', 'KeyI', 'KeyW', ...DIGITS]) {
      expect(craftKeyAction(key(code), false), code).toEqual({kind: 'pass'});
      expect(craftKeyAction(key(code, {target: {tagName: 'INPUT'}}), true), code).toEqual({kind: 'pass'});
    }
  });

  it('open: E closes; Esc / Tab / I close and go on; EVERY digit is swallowed and does nothing; the rest pass', () => {
    expect(craftKeyAction(key('KeyE'), true)).toEqual({kind: 'close'});
    expect(craftKeyAction(key('KeyE', {repeat: true}), true)).toEqual({kind: 'swallow'});
    for (const code of ['Escape', 'Tab', 'KeyI']) expect(craftKeyAction(key(code), true), code).toEqual({kind: 'close-pass'});
    // no crafting shortcut: 1–4 are digits like any other — consumed (never a quick slot 1–5 or the bag key 6), nothing else
    for (const code of DIGITS) {
      expect(craftKeyAction(key(code), true), code).toEqual({kind: 'swallow'});
      expect(craftKeyAction(key(code, {repeat: true}), true), code).toEqual({kind: 'swallow'});
    }
    // a browser / OS shortcut with a digit stays the browser's
    expect(craftKeyAction(key('Digit1', {ctrlKey: true}), true)).toEqual({kind: 'pass'});
    expect(craftKeyAction(key('Digit2', {metaKey: true}), true)).toEqual({kind: 'pass'});
    expect(craftKeyAction(key('Digit3', {altKey: true}), true)).toEqual({kind: 'pass'});
    // moving, looking, anything else: not consumed (walking away closes the view)
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyR', 'KeyF', 'KeyQ', 'Enter']) expect(craftKeyAction(key(code), true), code).toEqual({kind: 'pass'});
    // no key at all crafts
    const kinds = new Set(['KeyE', 'Escape', 'Tab', 'KeyI', 'Enter', 'Space', 'KeyC', ...DIGITS].flatMap(c => [craftKeyAction(key(c), true).kind, craftKeyAction(key(c, {repeat: true}), true).kind]));
    expect([...kinds].sort()).toEqual(['close', 'close-pass', 'pass', 'swallow']);
  });
});

describe('craft view: the DOM shell', () => {
  let dom: FakeDom | null = null;
  afterEach(() => { dom?.uninstall(); dom = null; });

  function shell(model: () => CraftViewModel | null) {
    const calls = {craft: [] as string[], close: 0};
    const view = new CraftView({model, craft: k => { calls.craft.push(k); }, close: () => { calls.close++; }});
    return {view, calls};
  }

  it('without a DOM (Node): show / render keep the model, nothing throws', () => {
    let m: CraftViewModel | null = craftModel(sources(), free);
    const {view} = shell(() => m);
    expect(view.visible).toBe(false);
    view.render();
    expect(view.last).toBeNull(); // (closed: nothing is rendered)
    view.show();
    expect(view.visible).toBe(true);
    expect(view.last).toBe(m);
    expect(view.renders).toBe(1);
    view.say('Crafted: Storage chest — hold E to carry it', false);
    expect([view.note, view.noteBad]).toEqual(['Crafted: Storage chest — hold E to carry it', false]);
    m = craftModel(sources(), () => 'No room on the car floor — move something first');
    view.render();
    expect(view.last).toBe(m);
    expect(view.renders).toBe(2);
    view.hide();
    expect(view.visible).toBe(false);
    view.show(); // (opening again clears the note)
    expect(view.note).toBe('');
  });

  it('mounts one #craftview section in #app, hidden until shown; render writes the rows; say writes the note', () => {
    dom = installFakeDom();
    const m = craftModel(sources(), free);
    const {view} = shell(() => m);
    view.show();
    const app = dom.el('#app');
    expect(app.children.length).toBe(1);
    const root = app.children[0] as FakeEl;
    expect(root.id).toBe(CRAFT_VIEW_ID);
    expect(root.tag).toBe('section');
    expect(root.getAttribute('aria-label')).toBe('Crafting bench');
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.innerHTML).toContain('<b class="cv-title">Crafting bench</b>');
    expect(dom.el('.cv-list').innerHTML).toBe(craftRowsHtml(m));
    view.say('Need 2 more Electrical parts', true);
    expect(dom.el('.cv-note').textContent).toBe('Need 2 more Electrical parts');
    expect(dom.el('.cv-note').classList.contains('refused')).toBe(true);
    view.say('Crafted: Route radar — hold E to drag it to a free plug', false);
    expect(dom.el('.cv-note').classList.contains('refused')).toBe(false);
    view.hide();
    expect(root.classList.contains('hidden')).toBe(true);
    view.show(); // (one section, ever)
    expect(app.children.length).toBe(1);
    expect(root.classList.contains('hidden')).toBe(false);
  });

  it('clicks: Craft on an enabled row crafts that kind; a disabled button and stray clicks do nothing; Close closes', () => {
    dom = installFakeDom();
    const m = craftModel(sources(), free);
    const {view, calls} = shell(() => m);
    view.show();
    const root = dom.el('#app').children[0] as FakeEl;
    const click = root.listeners.get('click')![0];
    const on = (sel: string, el: unknown) => ({target: {closest: (s: string) => (s === sel ? el : null)}});
    click(on('.cv-craft', {disabled: false, dataset: {kind: 'radar'}}));
    expect(calls).toEqual({craft: ['radar'], close: 0});
    click(on('.cv-craft', {disabled: true, dataset: {kind: 'sentry'}}));
    click(on('.cv-craft', {disabled: false, dataset: {kind: 'toString'}}));
    click(on('.cv-nothing', {}));
    click({target: null});
    expect(calls).toEqual({craft: ['radar'], close: 0});
    click(on('.cv-close', {}));
    expect(calls).toEqual({craft: ['radar'], close: 1});
  });
});
