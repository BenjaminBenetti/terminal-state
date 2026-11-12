// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE RECIPE LIST of the crafting bench (ui/craftView.ts) — its rows,
// the have / missing texts, why a Craft button is disabled, the totals' where-from note, the markup, the key scope and the thin DOM
// shell (on the tiny fake DOM). The bench that opens it is tests/craft-bench.test.ts.
import {afterEach, describe, expect, it} from 'vitest';
import {
  CRAFT_VIEW_ID, CRAFT_VIEW_TEXT, CraftView, costText, craftKeyAction, craftModel, craftRowsHtml, craftTotalsHtml, craftViewHtml, whereFromText,
  type CraftViewModel,
} from '../src/ui/craftView';
import {countMaterials, craftSources, type MaterialCounts} from '../src/craft/crafting';
import {EQUIPMENT, type EquipmentKind} from '../src/craft/equipment';
import {RECIPES} from '../src/craft/recipes';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {Inventory} from '../src/items/inventory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {fakeStore} from './helpers/craftBenchFakes';
import {installFakeDom, type FakeDom, type FakeEl} from './helpers/fakeDom';

/** Counts as the bench would hand them over: scrap 3 carried + 4 Lockbox, electrical 1 backpack + 2 chests. */
function counts(): MaterialCounts {
  const inv = new Inventory(), box = new TrainLockbox(), chest = fakeStore('eq-1');
  inv.add(inv.makeStack(SCRAP_METAL, 3));
  const bag = inv.makeStack('backpack', 1);
  inv.wearBag(bag);
  bag.bag![0] = inv.makeStack(ELECTRICAL_PARTS, 1);
  box.slots[0] = inv.makeStack(SCRAP_METAL, 4);
  chest.slots[0] = inv.makeStack(ELECTRICAL_PARTS, 2);
  return countMaterials(craftSources({inv, lockbox: box, stores: [chest]}));
}
const free = () => null;

describe('craft view: texts', () => {
  it('a cost line: enough / short / none needed', () => {
    expect(costText('Scrap metal', 4, 7)).toBe('Scrap metal 4 · have 7');
    expect(costText('Scrap metal', 4, 4)).toBe('Scrap metal 4 · have 4');
    expect(costText('Scrap metal', 4, 1)).toBe('Scrap metal 4 · have 1 — need 3 more');
    expect(costText('Scrap metal', 4, 0)).toBe('Scrap metal 4 · have 0 — need 4 more');
    expect(costText('Electrical parts', 0, 9)).toBe('Electrical parts —');
  });

  it('the where-from note', () => {
    expect(whereFromText({carried: 3, backpack: 0, lockbox: 4, chests: 0})).toBe('carried 3 · backpack 0 · Lockbox 4 · chests 0');
    const c = counts();
    expect(whereFromText(c[SCRAP_METAL])).toBe('carried 3 · backpack 0 · Lockbox 4 · chests 0');
    expect(whereFromText(c[ELECTRICAL_PARTS])).toBe('carried 0 · backpack 1 · Lockbox 0 · chests 2');
  });
});

describe('craft view: the model', () => {
  it('one row per recipe in RECIPES order: key, the unit name, the blurb, a line per material', () => {
    const m = craftModel(counts(), free);
    expect(m.rows.map(r => [r.key, r.kind, r.name])).toEqual([
      ['1', 'chest', 'Storage chest'], ['2', 'radar', 'Route radar'], ['3', 'sentry', 'Defense sentry'], ['4', 'scanner', 'Item scanner'],
    ]);
    m.rows.forEach((r, i) => {
      expect(r.name).toBe(EQUIPMENT[RECIPES[i].kind].name);
      expect(r.blurb).toBe(RECIPES[i].blurb);
      expect(r.costs.map(c => c.material)).toEqual([SCRAP_METAL, ELECTRICAL_PARTS]);
    });
    // scrap 7, electrical 3: the chest (2 / 0) and the radar (4 / 3) can be made; the sentry (8 / 6) and the scanner (5 / 5) cannot
    expect(m.rows.map(r => r.costs.map(c => c.text))).toEqual([
      ['Scrap metal 2 · have 7', 'Electrical parts —'],
      ['Scrap metal 4 · have 7', 'Electrical parts 3 · have 3'],
      ['Scrap metal 8 · have 7 — need 1 more', 'Electrical parts 6 · have 3 — need 3 more'],
      ['Scrap metal 5 · have 7', 'Electrical parts 5 · have 3 — need 2 more'],
    ]);
    expect(m.rows.map(r => r.costs.map(c => c.state))).toEqual([['ok', 'none'], ['ok', 'ok'], ['short', 'short'], ['ok', 'short']]);
    expect(m.rows.map(r => r.costs.map(c => c.short))).toEqual([[0, 0], [0, 0], [1, 3], [0, 2]]);
    expect(m.rows.map(r => r.can)).toEqual([true, true, false, false]);
    expect(m.rows.map(r => r.reason)).toEqual(['', '', 'Need 1 more Scrap metal and 3 more Electrical parts', 'Need 2 more Electrical parts']);
  });

  it('the footer: both material totals and where they are', () => {
    const m = craftModel(counts(), free);
    expect(m.totals.map(t => t.text)).toEqual([
      'Scrap metal 7 — carried 3 · backpack 0 · Lockbox 4 · chests 0',
      'Electrical parts 3 — carried 0 · backpack 1 · Lockbox 0 · chests 2',
    ]);
    expect(m.totals.map(t => [t.material, t.name, t.total])).toEqual([[SCRAP_METAL, 'Scrap metal', 7], [ELECTRICAL_PARTS, 'Electrical parts', 3]]);
  });

  it('a refusing equipment system disables the row with ITS text (before the missing materials)', () => {
    const block = (k: EquipmentKind) => (k === 'chest' ? 'No room on the car floor — move something first' : k === 'sentry' ? 'Too much equipment in the car (24 of 24) — leave some at a station' : null);
    const m = craftModel(counts(), block);
    expect(m.rows.map(r => r.can)).toEqual([false, true, false, false]);
    expect(m.rows[0].reason).toBe('No room on the car floor — move something first'); // (materials are there: only the block)
    expect(m.rows[2].reason).toBe('Too much equipment in the car (24 of 24) — leave some at a station'); // (short too: the block's text wins)
    expect(m.rows[2].costs[0].state).toBe('short'); // ... while its cost lines still say what is missing
    expect(m.rows[3].reason).toBe('Need 2 more Electrical parts');
  });

  it('nothing at all: every row says exactly what it needs', () => {
    const inv = new Inventory();
    const m = craftModel(countMaterials(craftSources({inv})), free);
    expect(m.rows.map(r => r.can)).toEqual([false, false, false, false]);
    expect(m.rows.map(r => r.reason)).toEqual([
      'Need 2 more Scrap metal', 'Need 4 more Scrap metal and 3 more Electrical parts', 'Need 8 more Scrap metal and 6 more Electrical parts',
      'Need 5 more Scrap metal and 5 more Electrical parts',
    ]);
    expect(m.totals.map(t => t.text)).toEqual([
      'Scrap metal 0 — carried 0 · backpack 0 · Lockbox 0 · chests 0', 'Electrical parts 0 — carried 0 · backpack 0 · Lockbox 0 · chests 0',
    ]);
  });
});

describe('craft view: the markup', () => {
  it('rows: the key, the name, the blurb, coloured cost lines, a Craft button that is disabled with its reason', () => {
    const m = craftModel(counts(), k => (k === 'radar' ? 'No room <on> the "car" floor & more' : null));
    const html = craftRowsHtml(m);
    expect(html.match(/<div class="cv-row /g)?.length).toBe(4);
    expect(html).toContain('<div class="cv-row cv-can" data-kind="chest"><div class="cv-key">1</div>');
    expect(html).toContain('<b class="cv-name">Storage chest</b>');
    expect(html).toContain(`<div class="cv-blurb">${RECIPES[0].blurb}</div>`);
    expect(html).toContain('<div class="cv-cost ok">Scrap metal 2 · have 7</div><div class="cv-cost none">Electrical parts —</div>');
    expect(html).toContain('<button class="cv-craft primary" type="button" data-kind="chest">Craft (1)</button><div class="cv-why"></div>');
    // a refused row: disabled, the reason escaped
    expect(html).toContain('<div class="cv-row cv-cant" data-kind="radar">');
    expect(html).toContain('<button class="cv-craft primary" type="button" data-kind="radar" disabled>Craft (2)</button><div class="cv-why">No room &lt;on&gt; the &quot;car&quot; floor &amp; more</div>');
    expect(html).toContain('<div class="cv-cost short">Scrap metal 8 · have 7 — need 1 more</div>');
    expect(html).toContain('data-kind="sentry" disabled>Craft (3)</button><div class="cv-why">Need 1 more Scrap metal and 3 more Electrical parts</div>');
    expect(html).toContain('data-kind="scanner" disabled>Craft (4)</button>');
  });

  it('the panel: the title, the not-paused line, the totals, the note, Close', () => {
    const m = craftModel(counts(), free);
    expect(craftTotalsHtml(m)).toBe('<div class="cv-total" data-material="scrap_metal"><b>Scrap metal 7</b> <span>— carried 3 · backpack 0 · Lockbox 4 · chests 0</span></div>'
      + '<div class="cv-total" data-material="electrical_parts"><b>Electrical parts 3</b> <span>— carried 0 · backpack 1 · Lockbox 0 · chests 2</span></div>');
    const html = craftViewHtml(m, 'Crafted: Route radar — roll it to a free plug', false);
    expect(CRAFT_VIEW_TEXT.title).toBe('Crafting bench');
    expect(html).toContain('<b class="cv-title">Crafting bench</b><span class="cv-live">● Not paused — keep an eye out</span>');
    expect(html).toContain('<div class="cv-note">Crafted: Route radar — roll it to a free plug</div>');
    expect(html).toContain('<button class="cv-close" type="button">Close (E)</button>');
    expect(html).toContain(craftRowsHtml(m));
    expect(craftViewHtml(m, 'No', true)).toContain('<div class="cv-note refused">No</div>');
    expect(craftViewHtml(null)).toContain('<div class="cv-list"></div><div class="cv-foot"></div>');
    // (the release packaging check refuses bundled text that starts like a root-absolute URL: none of the view's texts does)
    for (const t of Object.values(CRAFT_VIEW_TEXT)) expect(t).not.toMatch(/^\/[^\s/]/);
  });
});

describe('craft view: keys', () => {
  const key = (code: string, o: Partial<{repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; target: unknown}> = {}) => ({code, target: {tagName: 'BODY'}, ...o});
  it('closed, or typing in a field: nothing is the view\'s', () => {
    for (const code of ['KeyE', 'Escape', 'Tab', 'KeyI', 'Digit1', 'Digit4', 'Digit6', 'KeyW']) {
      expect(craftKeyAction(key(code), false), code).toEqual({kind: 'pass'});
      expect(craftKeyAction(key(code, {target: {tagName: 'INPUT'}}), true), code).toEqual({kind: 'pass'});
    }
  });

  it('open: E closes; Esc / Tab / I close and go on; 1–4 craft; every other digit is swallowed; the rest pass', () => {
    expect(craftKeyAction(key('KeyE'), true)).toEqual({kind: 'close'});
    expect(craftKeyAction(key('KeyE', {repeat: true}), true)).toEqual({kind: 'swallow'});
    for (const code of ['Escape', 'Tab', 'KeyI']) expect(craftKeyAction(key(code), true), code).toEqual({kind: 'close-pass'});
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4'].map(c => craftKeyAction(key(c), true))).toEqual([0, 1, 2, 3].map(index => ({kind: 'craft', index})));
    expect(craftKeyAction(key('Numpad2'), true)).toEqual({kind: 'craft', index: 1});
    // never a quick slot (1–5), the bag key (6) or any other digit binding — and a held key crafts once
    for (const code of ['Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Numpad5']) expect(craftKeyAction(key(code), true), code).toEqual({kind: 'swallow'});
    for (const code of ['Digit1', 'Digit4']) expect(craftKeyAction(key(code, {repeat: true}), true), code).toEqual({kind: 'swallow'});
    // a browser / OS shortcut with a digit stays the browser's
    expect(craftKeyAction(key('Digit1', {ctrlKey: true}), true)).toEqual({kind: 'pass'});
    expect(craftKeyAction(key('Digit2', {metaKey: true}), true)).toEqual({kind: 'pass'});
    expect(craftKeyAction(key('Digit3', {altKey: true}), true)).toEqual({kind: 'pass'});
    // moving, looking, anything else: not consumed (walking away closes the view)
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyR', 'KeyF', 'KeyQ']) expect(craftKeyAction(key(code), true), code).toEqual({kind: 'pass'});
    // a shorter list: only its rows are craft keys
    expect(craftKeyAction(key('Digit3'), true, 2)).toEqual({kind: 'swallow'});
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
    let m: CraftViewModel | null = craftModel(counts(), free);
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
    m = craftModel(counts(), () => 'No room on the car floor — move something first');
    view.render();
    expect(view.last).toBe(m);
    expect(view.renders).toBe(2);
    view.hide();
    expect(view.visible).toBe(false);
    view.show(); // (opening again clears the note)
    expect(view.note).toBe('');
  });

  it('mounts one #craftview section in #app, hidden until shown; render writes the rows and totals; say writes the note', () => {
    dom = installFakeDom();
    const m = craftModel(counts(), free);
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
    expect(dom.el('.cv-foot').innerHTML).toBe(craftTotalsHtml(m));
    view.say('Need 2 more Electrical parts', true);
    expect(dom.el('.cv-note').textContent).toBe('Need 2 more Electrical parts');
    expect(dom.el('.cv-note').classList.contains('refused')).toBe(true);
    view.say('Crafted: Route radar — roll it to a free plug', false);
    expect(dom.el('.cv-note').classList.contains('refused')).toBe(false);
    view.hide();
    expect(root.classList.contains('hidden')).toBe(true);
    view.show(); // (one section, ever)
    expect(app.children.length).toBe(1);
    expect(root.classList.contains('hidden')).toBe(false);
  });

  it('clicks: Craft on an enabled row crafts that kind; a disabled button and stray clicks do nothing; Close closes', () => {
    dom = installFakeDom();
    const m = craftModel(counts(), free);
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
