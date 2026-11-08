// Task studio-cosplay-general-20261108-225231-01 (lane GENERAL; user: "Armor pips should be circles, not squares."): the blue HUD armour
// pips (ui/hud.ts setArmor + ARMOR_CSS) are true CIRCLES — 1:1, border-radius 50 %, a half pip the same circle half filled — ten a row
// spanning exactly the health bar's width, further rows stacking upward with a 25 % overlap. PRESENTATION ONLY: the counts are still
// player/armor.ts pipRows(pool) (pinned below with values computed on the code before this change), and the armour maths (2.5 % pips,
// half-pip display rounded down, quarter-pip wear, enemy-only, the pre-wear pool of a hit) are untouched.
import fs from 'node:fs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {ARMOR, ARMOR_WEAR_PER_HIT, armorHit, displayHalfPips, pipRows, pipsText} from '../src/player/armor';
import {ARMOR_CSS, ARMOR_PIP_COL_GAP, ARMOR_PIP_GAP, armorPipsHtml, armorRowMargin} from '../src/ui/hud';
import type {PlayerHit} from '../src/player/hits';
import type {ItemStack} from '../src/items/inventory';
import {FakeEl, installFakeDom, type FakeDom} from './helpers/fakeDom';

const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** One CSS declaration of a rule in ARMOR_CSS (selector exact). */
function decl(selector: string, prop: string): string | undefined {
  const rule = ARMOR_CSS.split('\n').find(l => l.startsWith(`${selector} {`));
  if (!rule) return undefined;
  const m = new RegExp(`(?:\\{|;)\\s*${prop}:\\s*([^;]+);`).exec(rule);
  return m?.[1].trim();
}

/** Evaluates a CSS length (`calc(...)`, px, %) in px with `100%` = `pct` px (digits / px / % / + - * / ( ) only). */
function px(expr: string, pct: number): number {
  const body = /^calc\((.*)\)$/.exec(expr.trim())?.[1] ?? expr;
  const js = body.replace(/(\d+(?:\.\d+)?)%/g, (_, n: string) => `(${n} / 100 * ${pct})`).replace(/(\d+(?:\.\d+)?)px/g, '$1');
  if (!/^[\d\s.+\-*/()]+$/.test(js)) throw new Error(`not a plain length: ${expr}`);
  return Function(`"use strict"; return (${js});`)() as number;
}

/** The pip diameter for a row `w` px wide: ten columns, nine gaps (the grid's 1fr columns). */
const diameter = (w: number) => (w - (ARMOR.pipsPerRow - 1) * ARMOR_PIP_COL_GAP) / ARMOR.pipsPerRow;

describe('armor pips: true circles', () => {
  it('each pip is a circle: as wide as its column, aspect-ratio 1 / 1, border-radius 50 %, no fixed height; still blue', () => {
    expect(decl('#armor-pips i', 'width')).toBe('100%');
    expect(decl('#armor-pips i', 'aspect-ratio')).toBe('1 / 1');
    expect(decl('#armor-pips i', 'border-radius')).toBe('50%');
    expect(decl('#armor-pips i', 'height')).toBeUndefined(); // (the old 6 px bars)
    expect(decl('#armor-pips i', 'box-sizing')).toBe('border-box'); // the 1 px rim stays inside the circle
    expect(decl('#armor-pips i', 'background')).toBe('#3d8fe0');
  });

  it('a half pip is the SAME circle (no width change) filled on its left half', () => {
    const half = ARMOR_CSS.split('\n').find(l => l.startsWith('#armor-pips i.half {'))!;
    expect(half).toBeTruthy();
    expect(half).not.toMatch(/width|height|border-radius/); // inherits the full circle
    expect(decl('#armor-pips i.half', 'background')).toMatch(/^linear-gradient\(90deg, #3d8fe0 50%, rgba\([^)]+\) 50%\)$/);
    // an odd half-pip count ends on ONE half circle
    const html = armorPipsHtml(pipRows(0.09375)); // 7 half pips = 3½
    expect(html).toBe(`<div class="arow">${'<i></i>'.repeat(3)}<i class="half"></i></div>`);
  });

  it('ten per row spanning exactly the health bar (its border box): 10 circles + 9 gaps = the bar width', () => {
    expect(decl('#armor-pips .arow', 'grid-template-columns')).toBe(`repeat(${ARMOR.pipsPerRow}, 1fr)`);
    expect(ARMOR.pipsPerRow).toBe(10);
    expect(decl('#armor-pips .arow', 'column-gap')).toBe(`${ARMOR_PIP_COL_GAP}px`);
    // #armor-pips is the bar's child, 1 px past each side = over the bar's 1 px border: the row is the bar's border-box width
    expect([decl('#armor-pips', 'left'), decl('#armor-pips', 'right')]).toEqual(['-1px', '-1px']);
    expect(styles).toMatch(/#vitals \.bar \{[^}]*border: 1px solid/);
    expect(decl('#vitals .bar.health', 'position')).toBe('relative');
    for (const w of [150, 177, 202, 217, 260]) {
      const d = diameter(w);
      expect(10 * d + 9 * ARMOR_PIP_COL_GAP).toBeCloseTo(w, 9);
      expect(d).toBeGreaterThan(10); // a readable circle at every vitals width (220 / 260 px panels)
    }
    // the markup: pipRows' rows, ten pips a row, bottom row first
    const html = armorPipsHtml(pipRows(0.2625)); // 10½ pips
    expect(html.match(/<div class="arow">/g)).toHaveLength(2);
    expect(html.split('</div>')[0].match(/<i><\/i>/g)).toHaveLength(10);
    expect(html.split('</div>')[1]).toBe('<div class="arow"><i class="half"></i>');
  });

  it('rows stack UPWARD over the bar, each overlapping the one below by 25 % of a pip (a negative margin in % of the row width)', () => {
    expect(decl('#armor-pips', 'display')).toBe('flex');
    expect(decl('#armor-pips', 'flex-direction')).toBe('column-reverse'); // pipRows' first row (the first ten) at the bottom
    expect(decl('#armor-pips', 'bottom')).toBe(`calc(100% + ${ARMOR_PIP_GAP}px)`);
    expect(ARMOR.rowOverlap).toBe(0.25);
    const m = decl('#armor-pips .arow + .arow', 'margin-bottom')!;
    expect(m).toBeTruthy();
    for (const w of [150, 202, 217, 260]) {
      const d = diameter(w);
      expect(px(m, w)).toBeCloseTo(-0.25 * d, 9); // (a flex item's % margins resolve against the container's WIDTH)
      // the stack: one pip + (rows - 1) x 75 % of a pip
      for (const rows of [1, 2, 3, 4]) expect(d + (rows - 1) * (d + px(m, w))).toBeCloseTo(d * (1 + 0.75 * (rows - 1)), 9);
    }
  });

  it('the HP row reserves the whole stack above the bar: never short, at most the HP number\'s share generous', () => {
    const vitals = /#vitals \{[^}]*width: (\d+)px/.exec(styles)!, narrow = /#vitals \{ width: (\d+)px; \}/.exec(styles);
    const widths = [Number(vitals[1]), ...(narrow ? [Number(narrow[1])] : [])];
    expect(widths).toEqual([260, 220]);
    expect(styles).toMatch(/#vitals \.tag \{[^}]*width: 20px/); // the HP tag
    expect(styles).toMatch(/#vitals \.row \{[^}]*gap: 8px/); // tag | bar | number
    for (const wv of widths) for (const hpNum of [0, 7, 22]) {
      const bar = wv - 20 - 2 * 8 - hpNum, d = diameter(bar);
      for (const rows of [1, 2, 3, 4]) {
        const k = 1 + 0.75 * (rows - 1), need = 6 + ARMOR_PIP_GAP + d * k, got = px(armorRowMargin(rows), wv);
        expect(got).toBeGreaterThanOrEqual(need - 1e-9);
        expect(got - need).toBeLessThanOrEqual(k * hpNum / 10 + 1e-9);
      }
    }
  });
});

describe('armor pips: the counts and the maths are unchanged (presentation only)', () => {
  // Computed on the code BEFORE this change (player/armor.ts displayHalfPips / pipsText / pipRows; F = full, H = half), incl. worn values.
  const W = 0.00625;
  const PINNED: [number, number, string, string[]][] = [
    [0, 0, '0', []], [W, 0, '0', []], [0.0124, 0, '0', []], [0.0125, 1, '½', ['H']], [0.0125 + W, 1, '½', ['H']], [0.025, 2, '1', ['F']],
    [0.025 - W, 1, '½', ['H']], [0.1 - W, 7, '3½', ['FFFH']], [0.1 - 2 * W, 7, '3½', ['FFFH']], [0.1 - 3 * W, 6, '3', ['FFF']], [0.1, 8, '4', ['FFFF']],
    [0.1 + 0.025, 10, '5', ['FFFFF']], [0.125 - W, 9, '4½', ['FFFFH']], [0.2375, 19, '9½', ['FFFFFFFFFH']], [0.25, 20, '10', ['FFFFFFFFFF']],
    [0.25 + W, 20, '10', ['FFFFFFFFFF']], [0.2625, 21, '10½', ['FFFFFFFFFF', 'H']], [0.5, 40, '20', ['FFFFFFFFFF', 'FFFFFFFFFF']],
    [0.5125, 41, '20½', ['FFFFFFFFFF', 'FFFFFFFFFF', 'H']], [0.8, 64, '32', ['FFFFFFFFFF', 'FFFFFFFFFF', 'FFFFFFFFFF', 'FF']],
    [0.8 - W, 63, '31½', ['FFFFFFFFFF', 'FFFFFFFFFF', 'FFFFFFFFFF', 'FH']],
  ];
  const code = (rows: ('full' | 'half')[][]) => rows.map(r => r.map(x => (x === 'full' ? 'F' : 'H')).join(''));

  it('half pips, text and rows for sample pools (fresh, worn, capped) are identical to before', () => {
    for (const [pool, halves, text, rows] of PINNED) {
      expect([displayHalfPips(pool), pipsText(pool), code(pipRows(pool))], String(pool)).toEqual([halves, text, rows]);
    }
  });

  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('the HUD draws exactly pipRows(pool): a circle per full pip, one half circle for an odd half, rows of ten', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const bar = dom.el('#vitals .bar.health');
    const row = new FakeEl('div');
    bar.parent = row;
    const el = dom.el('#armor-pips');
    for (const [pool, , , rows] of PINNED) {
      hud.setArmor(pool);
      if (!rows.length) { expect(el.classList.contains('none'), String(pool)).toBe(true); expect(row.style.marginTop).toBe(''); continue; }
      expect(el.classList.contains('none')).toBe(false);
      const drawn = el.innerHTML.split('</div>').filter(Boolean).map(r => (r.match(/<i( class="half")?><\/i>/g) ?? []).map(i => (i.includes('half') ? 'H' : 'F')).join(''));
      expect(drawn, String(pool)).toEqual(rows);
      expect(row.style.marginTop).toBe(armorRowMargin(rows.length));
    }
  });

  it('units, wear, enemy-only and the pre-wear pool of a hit are untouched', () => {
    expect([ARMOR.pip, ARMOR.halfPip, ARMOR.pipsPerRow, ARMOR.rowOverlap, ARMOR.cap, ARMOR_WEAR_PER_HIT]).toEqual([0.025, 0.0125, 10, 0.25, 0.8, 0.00625]);
    const st = (itemId: string, uid: number): ItemStack => ({itemId, count: 1, uid});
    const worn = {chest: st('armor_vest', 1), helmet: st('helmet', 2)};
    const hit = (o: Partial<PlayerHit> = {}): PlayerHit => ({amount: 20, source: 'zombie', location: 'torso', ...o});
    const {resolved, wore} = armorHit(hit(), worn, () => 0.9); // roll 0.9: the second contributor (the vest)
    expect(resolved.armor).toBeCloseTo(0.125, 12); // the pool BEFORE this hit's wear rides on the hit (its injury save)
    expect(wore).toEqual({slot: 'chest', before: 0.1, after: 0.09375});
    expect(displayHalfPips(0.025 + 0.09375)).toBe(9); // 4.75 pips shown as 4½ (rounded down)
    const fall = armorHit(hit({source: 'fall', location: 'leg'}), worn, () => 0);
    expect([fall.resolved.armor, fall.resolved.absorbed, fall.wore]).toEqual([0, 0, null]); // not an enemy: no armour at all
  });
});
