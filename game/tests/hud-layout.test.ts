// Task gasmask-hud-fix-20261030: the hotbar (Q, 1-5, 6, G, possibly a later melee cell) must stay clear of the vitals and the
// weapon panel at narrow viewports. These checks read the real stylesheet (src/styles.css + the gear lane's injected CSS) and
// model the flex band; tools/qa/hud-layout-check.mjs measures the same layout in a browser (no game world).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
const gearCss = readFileSync(fileURLToPath(new URL('../src/ui/gearStyles.ts', import.meta.url)), 'utf8');

/** The declarations of the first rule for `selector` inside `scope` (whole sheet or one media block). */
function rule(scope: string, selector: string): string {
  const i = scope.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`no rule for ${selector}`);
  return scope.slice(i + selector.length + 2, scope.indexOf('}', i));
}
const px = (decls: string, prop: string): number => {
  const m = new RegExp(`(?:^|[;\\s])${prop.replace(/[-]/g, '\\-')}:\\s*(-?[\\d.]+)px`).exec(decls);
  if (!m) throw new Error(`no ${prop} in "${decls}"`);
  return Number(m[1]);
};
/** The body of `@media (max-width: Npx) { ... }` (balanced braces). */
function media(maxWidth: number): string {
  const i = css.indexOf(`@media (max-width: ${maxWidth}px) {`);
  if (i < 0) throw new Error(`no ${maxWidth}px media block`);
  let depth = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}' && --depth === 0) return css.slice(j + 1, k);
  }
  throw new Error('unbalanced media block');
}

const vitals = rule(css, '#vitals'), weapon = rule(css, '#weapon-panel'), hint = rule(css, '#weapon-hint'), bar = rule(css, '#hotbar');
const narrow = media(1100);
const GAP = 8; // minimum clear space required between the bar and a side panel

describe('hotbar band vs the vitals and the weapon panel', () => {
  it('the bar is bounded by a band, not centred at a fixed width (cells may shrink)', () => {
    expect(bar).not.toMatch(/translateX\(-50%\)/);
    expect(bar).toMatch(/left:\s*var\(--hb-left\)/);
    expect(bar).toMatch(/right:\s*var\(--hb-right\)/);
    const cell = rule(css, '#hotbar .slot');
    expect(cell).toMatch(/flex:\s*0 1 auto/);
    expect(px(cell, 'min-width')).toBeGreaterThan(0);
  });

  it('wide viewports: the symmetric band clears the vitals and the widest weapon hint', () => {
    const left = px(bar, '--hb-left'), right = px(bar, '--hb-right');
    expect(left).toBe(right); // centred under the crosshair
    expect(left).toBeGreaterThanOrEqual(px(vitals, 'left') + px(vitals, 'width') + GAP);
    expect(right).toBeGreaterThanOrEqual(px(weapon, 'right') + px(hint, 'max-width') + GAP);
  });

  it('<= 1100 px: the band is the actual gap between the (slimmer) vitals and the (narrower) hint', () => {
    const b = rule(narrow, '#hotbar'), v = rule(narrow, '#vitals'), h = rule(narrow, '#weapon-hint');
    expect(px(b, '--hb-left')).toBeGreaterThanOrEqual(px(vitals, 'left') + px(v, 'width') + GAP);
    expect(px(b, '--hb-right')).toBeGreaterThanOrEqual(px(weapon, 'right') + px(h, 'max-width') + GAP);
  });
});

describe('cells stay readable at 960 and 1280 px, with or without one more cell', () => {
  // natural widths at those viewports (base, <= 1400 / <= 1250 / <= 1100 overrides) and the fixed margins / gaps
  const m1400 = media(1400), m1250 = media(1250);
  const gap = px(bar, 'gap'), bagMargin = px(rule(gearCss, '#hotbar .slot.bagslot'), 'margin-left'), throwMargin = px(rule(gearCss, '#hotbar .slot.throwslot'), 'margin-left');
  it('the compact Q cell keeps its width; the numbered cells share the squeeze', () => {
    expect(rule(css, '#hotbar .slot.maskslot')).toMatch(/flex-shrink:\s*0/);
  });
  const at = (vw: number) => {
    const cell = vw <= 1100 ? px(rule(narrow, '#hotbar .slot'), 'width') : px(rule(m1400, '#hotbar .slot'), 'width');
    const q = px(rule(m1250, '#hotbar .slot.maskslot'), 'width'), qMargin = px(rule(m1250, '#hotbar .slot.maskslot'), 'margin-right');
    const b = vw <= 1100 ? rule(narrow, '#hotbar') : bar;
    return {cell, q, qMargin, band: vw - px(b, '--hb-left') - px(b, '--hb-right')};
  };
  /** Flex model: Q fixed, `n` numbered cells (equal basis) shrink equally when the band is too narrow. */
  const layout = (vw: number, n: number) => {
    const L = at(vw), fixed = L.q + L.qMargin + bagMargin + throwMargin + gap * n; // n numbered cells + Q = n + 1 items, n gaps
    const cell = Math.min(L.cell, (L.band - fixed) / n);
    return {cell, total: fixed + cell * n, band: L.band};
  };
  for (const [vw, n] of [[960, 7], [960, 8], [1280, 7], [1280, 8]] as const) {
    it(`${vw} px, Q + ${n} cells`, () => {
      const r = layout(vw, n);
      expect(r.total).toBeLessThanOrEqual(r.band + 0.5);
      expect(r.cell).toBeGreaterThanOrEqual(vw <= 1100 ? 44 : 64);
    });
  }
});
