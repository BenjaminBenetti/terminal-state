// Task studio-bunker-rework-20261109-205115-01, fix 1 (user: "Objective text too long / cuts across screen. Wrap with roughly half the
// text on a new line / keep out of the player's face"): the Bunker's objective title on TWO BALANCED lines at the same font size inside
// a bounded panel; every short objective unchanged (one line, the same text node).

import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {OBJECTIVE_ONE_LINE_MAX, balancedLines, setObjectiveTitle} from '../src/ui/objectiveTitle';

const ROOT = path.resolve(__dirname, '../..');
// the titles as game.ts exports them (read from the source: importing game.ts pulls the renderer)
const GAME = fs.readFileSync(path.join(ROOT, 'game/src/game.ts'), 'utf8');
const constant = (name: string): string => {
  const m = GAME.match(new RegExp(`export const ${name} = '([^']*)'`));
  if (!m) throw new Error(`no ${name}`);
  return m[1];
};
const BUNKER_OBJECTIVE = constant('BUNKER_OBJECTIVE'), MARKET_OBJECTIVE = constant('MARKET_OBJECTIVE'), SCAVENGE_OBJECTIVE = constant('SCAVENGE_OBJECTIVE');

/** A minimal element (the setter's DOM surface: textContent, replaceChildren, children, class toggles on the panel). */
function fakePanel() {
  const classes = new Set<string>();
  const panel = {classList: {toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c: string) => classes.has(c)}};
  const el = {
    parentElement: panel, children: [] as {className: string; textContent: string}[], _text: '',
    ownerDocument: {createElement: () => ({className: '', textContent: ''})},
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; },
    set textContent(v: string) { this.children = []; this._text = v; },
    replaceChildren(...kids: {className: string; textContent: string}[]) { this._text = ''; this.children = kids; },
  };
  return {panel, el};
}

describe('the objective title wraps a long objective into two balanced lines', () => {
  it('the Bunker title: two lines, every word kept in order, the halves within a fifth of each other', () => {
    const lines = balancedLines(BUNKER_OBJECTIVE);
    expect(lines.length).toBe(2);
    expect(lines.join(' ')).toBe(BUNKER_OBJECTIVE);
    const [a, b] = lines.map(l => l.length);
    expect(Math.abs(a - b) / ((a + b) / 2)).toBeLessThan(0.2);
    // the instructions stay: the generators, the core, the return to the train
    expect(lines.join(' ')).toMatch(/generators/);
    expect(lines.join(' ')).toMatch(/core/);
    expect(lines.join(' ')).toMatch(/Return to the train/);
  });

  it('short objectives (Scavenge, the Market, the Reactor) stay one line, unchanged', () => {
    for (const t of [SCAVENGE_OBJECTIVE, MARKET_OBJECTIVE, 'Restart the reactor']) {
      expect(t.length).toBeLessThanOrEqual(OBJECTIVE_ONE_LINE_MAX);
      expect(balancedLines(t)).toEqual([t]);
    }
  });

  it('the DOM: two block lines + the bounded panel class for the Bunker; plain text and no class for a short title', () => {
    const {panel, el} = fakePanel();
    setObjectiveTitle(el as unknown as Element, BUNKER_OBJECTIVE);
    expect(el.children.map(c => [c.className, c.textContent])).toEqual(balancedLines(BUNKER_OBJECTIVE).map(l => ['ln', l]));
    expect(panel.classList.contains('obj-two-line')).toBe(true);
    setObjectiveTitle(el as unknown as Element, SCAVENGE_OBJECTIVE);
    expect(el.textContent).toBe(SCAVENGE_OBJECTIVE);
    expect(el.children.length).toBe(0);
    expect(panel.classList.contains('obj-two-line')).toBe(false);
  });

  it('the CSS keeps the legible size (12 px), shows the lines as blocks and bounds a two-line panel; game.ts sets every title through it', () => {
    const css = fs.readFileSync(path.join(ROOT, 'game/src/styles.css'), 'utf8');
    expect(css).toMatch(/#objective \.obj-title \{ font-size: 12px;/);
    expect(css).toMatch(/#objective\.obj-two-line \{ max-width: min\(46vw, 640px\); \}/);
    expect(css).toMatch(/#objective \.obj-title \.ln \{ display: block; \}/);
    expect(GAME).toMatch(/if \(obj\) setObjectiveTitle\(obj, key\.level === 'reactor'/);
  });
});
