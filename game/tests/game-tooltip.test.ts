// Task studio-ui-subway-maps-20261108-074144-01 (user: "the tool tips on the inventory menu remain open after the user closes the menu if
// they are hovering an item when the menu closes. Lets use in game tooltipos"): the game's own tooltip (ui/tooltip.ts) replaces native
// `title` tooltips in the menus. Its lifecycle on a Node DOM with real event dispatch (helpers/paperMapDom.ts): hover shows the item's
// content; a panel that closes under a STILL cursor takes the tooltip with it (the frame check — the bug the user saw); a re-render
// re-binds to the new element; keys, a pressed button (drag / held use), the wheel, blur, pointer lock and hideTooltip() hide it;
// keyboard focus shows it beside the element; content is text (escaped in, never parsed); the item content of real stacks; and the
// menus / item grids no longer carry native titles. Node only.

import fs from 'node:fs';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {MiniEvent, installMiniDom, type MiniDom, type MiniEl} from './helpers/paperMapDom';
import {hideTooltip, installTooltips, refreshTooltip, setTip, tipAttrs, tipOf, tooltipElement, tooltipState} from '../src/ui/tooltip';
import {itemTip, itemTipLines} from '../src/ui/itemTip';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {WEAPONS} from '../src/weapons/weapons';

const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

let dom: MiniDom;
let frames: (() => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;
const runFrames = () => { const f = frames; frames = []; for (const cb of f) cb(); };

beforeEach(() => {
  dom = installMiniDom(1280, 720);
  frames = [];
  g.requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length; };
  g.cancelAnimationFrame = () => {};
  installTooltips();
});
afterEach(() => {
  hideTooltip();
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
  dom.uninstall();
});

/** A panel with three item slots (like #inventory: a screen that closes with the `hidden` class). */
function panel(): {screen: MiniEl; grid: MiniEl; slot: (i: number) => MiniEl} {
  const screen = dom.doc.body.appendChild(dom.doc.createElement('section'));
  screen.id = 'inventory';
  screen.className = 'screen';
  screen.innerHTML = '<div id="inv-pack"></div>';
  const grid = screen.querySelector('#inv-pack')!;
  grid.innerHTML = ['Bandage', 'Water bottle', 'Rifle — "Kept running"'].map((n, i) =>
    `<div class="slot filled" data-index="${i}"${tipAttrs({head: n, lines: [`line ${i}`], hint: 'Drag to move'})}><span class="nm">${i}</span></div>`).join('');
  return {screen, grid, slot: i => grid.querySelectorAll('.slot')[i]};
}
const over = (el: MiniEl, x = 300, y = 200, buttons = 0) => el.dispatchEvent(new MiniEvent('pointerover', {clientX: x, clientY: y, buttons}));
const move = (el: MiniEl, x = 302, y = 201, buttons = 0) => el.dispatchEvent(new MiniEvent('pointermove', {clientX: x, clientY: y, buttons}));

describe('the game tooltip: show / content', () => {
  it('hovering a [data-tip] element shows its heading, lines and hint as text; the anchor is described by it', () => {
    const {slot} = panel();
    over(slot(2));
    const t = tooltipState()!;
    expect(t.via).toBe('pointer');
    expect(t.content).toEqual({head: 'Rifle — "Kept running"', lines: ['line 2'], hint: 'Drag to move', tone: 'info'}); // quotes survive the attribute
    const el = tooltipElement()!;
    expect(el.getAttribute('role')).toBe('tooltip');
    expect(el.classList.contains('gt-hidden')).toBe(false);
    expect(el.querySelector('.gt-head')!.textContent).toBe('Rifle — "Kept running"');
    expect(el.querySelector('.gt-body')!.textContent).toBe('line 2');
    expect(slot(2).getAttribute('aria-describedby')).toBe('game-tip');
    over(slot(0)); // to the next slot: follows
    expect(tooltipState()!.content.head).toBe('Bandage');
    expect(slot(2).getAttribute('aria-describedby')).toBeNull();
  });

  it('text only: markup in content is never parsed; tones; setTip on a live element updates what is shown', () => {
    const b = dom.doc.body.appendChild(dom.doc.createElement('button'));
    const be = b as unknown as Element; // (the Node DOM's element as the DOM type the API takes)
    setTip(be, {head: '<img src=x onerror=alert(1)>', lines: ['a', 'b'], tone: 'danger'});
    over(b);
    const el = tooltipElement()!;
    expect(el.querySelector('.gt-head')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('.gt-head')!.querySelectorAll('img')).toHaveLength(0);
    expect(el.classList.contains('gt-danger')).toBe(true);
    setTip(be, {head: 'Steal', hint: 'The trader will see you', tone: 'danger'});
    expect(el.querySelector('.gt-head')!.textContent).toBe('Steal');
    setTip(be, null);
    expect(tipOf(be)).toBeNull();
    expect(tooltipState()).toBeNull();
    expect(tipAttrs(null)).toBe('');
  });

  it('clamped inside the viewport near the right / bottom edge', () => {
    const {slot} = panel();
    over(slot(0), 1270, 712);
    const el = tooltipElement()!;
    (el as unknown as {getBoundingClientRect: () => {width: number; height: number}}).getBoundingClientRect = () => ({width: 300, height: 90});
    move(slot(0), 1270, 712);
    const m = String(el.style.transform).match(/translate\((-?\d+)px, (-?\d+)px\)/)!;
    const [x, y] = [Number(m[1]), Number(m[2])];
    expect(x + 300).toBeLessThanOrEqual(1280 - 8);
    expect(y + 90).toBeLessThanOrEqual(720 - 8);
    expect(x).toBeGreaterThanOrEqual(8);
  });
});

describe('the game tooltip: nothing lingers', () => {
  it('THE BUG: the panel closes while the cursor stays still -> the frame check hides the tooltip (no pointer event needed)', () => {
    const {screen, slot} = panel();
    over(slot(1));
    expect(tooltipState()).not.toBeNull();
    screen.classList.add('hidden'); // the menu closed (Tab / Esc / death / travel ...): no pointer event at all
    runFrames();
    expect(tooltipState()).toBeNull();
    expect(tooltipElement()!.classList.contains('gt-hidden')).toBe(true);
    runFrames();
    expect(frames).toHaveLength(0); // the watcher stops once hidden
  });

  it('the anchor removed (a panel unmounted) -> hidden on the next frame; a re-render re-binds to the slot now under the still pointer', () => {
    const {grid, slot} = panel();
    over(slot(0), 300, 200);
    // a re-render: the views write their slots with innerHTML, so the hovered element is replaced
    grid.innerHTML = `<div class="slot filled"${tipAttrs({head: 'Bandage ×2', lines: ['+25 health']})}></div>`;
    const fresh = grid.querySelectorAll('.slot')[0];
    (dom.doc as unknown as {elementFromPoint: (x: number, y: number) => MiniEl | null}).elementFromPoint = (x, y) => (x === 300 && y === 200 ? fresh : null);
    refreshTooltip();
    expect(tooltipState()!.content.head).toBe('Bandage ×2');
    expect(tooltipState()!.anchor).toBe(fresh);
    grid.innerHTML = '';
    runFrames();
    expect(tooltipState()).toBeNull();
  });

  it('any key, a pressed button (drag / held use), the wheel, window blur, pointer lock and hideTooltip() hide it', () => {
    const {slot} = panel();
    const cases: [string, () => void][] = [
      ['key', () => { dom.win.dispatchEvent(new MiniEvent('keydown', {code: 'Tab', key: 'Tab'})); }],
      ['pointerdown', () => { slot(0).dispatchEvent(new MiniEvent('pointerdown', {button: 0, buttons: 1})); }],
      ['wheel', () => { slot(0).dispatchEvent(new MiniEvent('wheel', {deltaY: 100})); }],
      ['blur', () => { dom.win.dispatchEvent(new MiniEvent('blur', {})); }],
      ['hideTooltip', () => hideTooltip()],
    ];
    for (const [name, act] of cases) {
      dom.doc.body.dispatchEvent(new MiniEvent('pointerup', {})); // no button held
      over(slot(0));
      expect(tooltipState(), name).not.toBeNull();
      act();
      expect(tooltipState(), name).toBeNull();
    }
    // a held button (dragging) never shows it; the next plain move does
    slot(1).dispatchEvent(new MiniEvent('pointerdown', {button: 0, buttons: 1}));
    move(slot(1), 310, 210, 1);
    over(slot(2), 320, 220, 1);
    expect(tooltipState()).toBeNull();
    dom.doc.body.dispatchEvent(new MiniEvent('pointerup', {}));
    move(slot(2), 321, 221, 0);
    expect(tooltipState()!.content.head).toMatch(/Rifle/);
    // pointer lock (back to play): hidden, and hovering does not bring it back while locked
    (dom.doc as unknown as {pointerLockElement: unknown}).pointerLockElement = dom.doc.body;
    dom.doc.dispatchEvent(new MiniEvent('pointerlockchange', {}));
    expect(tooltipState()).toBeNull();
    over(slot(0));
    expect(tooltipState()).toBeNull();
    (dom.doc as unknown as {pointerLockElement: unknown}).pointerLockElement = null;
    dom.doc.dispatchEvent(new MiniEvent('pointerlockchange', {}));
    over(slot(0));
    expect(tooltipState()).not.toBeNull();
  });

  it('leaving the anchor hides it; hovering an element in a hidden panel never shows one', () => {
    const {screen, slot} = panel();
    over(slot(0));
    slot(0).dispatchEvent(new MiniEvent('pointerout', {relatedTarget: screen}));
    expect(tooltipState()).toBeNull();
    screen.classList.add('hidden');
    over(slot(1));
    expect(tooltipState()).toBeNull();
  });

  it('keyboard: focus after a key shows it beside the element; focus out hides it; a click focus does not', () => {
    const {slot} = panel();
    dom.win.dispatchEvent(new MiniEvent('keydown', {code: 'Tab', key: 'Tab'}));
    slot(1).dispatchEvent(new MiniEvent('focusin', {}));
    expect(tooltipState()!.via).toBe('focus');
    slot(1).dispatchEvent(new MiniEvent('focusout', {}));
    expect(tooltipState()).toBeNull();
    slot(0).dispatchEvent(new MiniEvent('pointerdown', {button: 0, buttons: 1}));
    slot(0).dispatchEvent(new MiniEvent('focusin', {}));
    expect(tooltipState()).toBeNull();
  });
});

describe('item content and the views', () => {
  it('a stack\'s tooltip: name (×count), rounds loaded and caliber, effect, armour left, filter, bag contents', () => {
    const inv = new Inventory();
    const rifle = inv.makeStack('rifle', 1);
    rifle.mag = 7;
    const t = itemTip(rifle, 'Drag to move', {inv});
    expect(t.head).toBe(itemDef('rifle').name);
    expect(t.lines![0]).toMatch(new RegExp(`^7 / ${WEAPONS.rifle.magazine} loaded · takes .+ · \\d+ in reserve$`));
    const water = {...inv.makeStack('water', 1), count: 3} as ItemStack;
    expect(itemTip(water).head).toMatch(/×3$/);
    expect(itemTipLines(water)[0]).toMatch(/water/i);
    const vest = inv.makeStack('armor_vest', 1);
    vest.armor = 0.09375;
    expect(itemTipLines(vest)).toContain('armor 3½ / 4 pips (9.38 %, worn)');
    const mask = inv.makeStack('gas_mask', 1);
    expect(itemTipLines(mask)[0]).toMatch(/^Filter \d+ % fitted$/);
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack('water', 1);
    expect(itemTipLines(bag)).toContain(`1 of ${bag.bag!.length} slots used inside`);
  });

  it('no native title tooltips remain in the menus and item grids; every close path hides the game tooltip', () => {
    for (const f of ['ui/inventoryUI.ts', 'ui/bagView.ts', 'ui/lockboxView.ts', 'ui/paperMap.ts', 'ui/mainMenu.ts', 'main.ts', 'player/injuries.ts']) {
      const s = src(f);
      expect(s, f).not.toMatch(/\btitle="\$\{|\.title = |\btitle="[A-Z]|<title>\$\{/);
    }
    expect(src('game.ts')).toMatch(/this\.invUI\.cancelDrag\(\);\s*hideTooltip\(\);/); // Game.setState: every screen change
    for (const f of ['ui/bagView.ts', 'ui/lockboxView.ts']) expect(src(f), f).toMatch(/hide\(\): void \{\s*this\.cancelDrag\(\);\s*this\.root\?\.classList\.add\('hidden'\);\s*hideTooltip\(\);/);
    expect(src('ui/paperMap.ts')).toMatch(/this\.openFlag = false;\s*hideTooltip\(\);/);
    expect(src('main.ts')).toMatch(/installTooltips\(\);[^\n]*\n\s*const game = new Game\(canvas, qa\);/);
    // the tooltip is never a drop target / slot and takes no pointer events
    expect(src('ui/tooltip.ts')).toMatch(/#game-tip \{[^}]*pointer-events: none/);
    expect(src('ui/tooltip.ts')).toMatch(/el\.className = 'gt-hidden';/); // its only classes: gt-* (never .slot)
  });
});
