// Task studio-bunker-rework-20261109-205115-01 (user: "Objective text too long / cuts across screen. Wrap with roughly half the text on
// a new line / keep out of the player's face"): the HUD objective title (#objective .obj-title) at its legible size, a long title in TWO
// BALANCED LINES (about half the words on each) inside a bounded panel width (styles.css #objective max-width). Pure split + a DOM
// setter; every short title (Scavenge, Market, Reactor) stays one line exactly as before.

/** Titles longer than this (characters) are shown on two lines. */
export const OBJECTIVE_ONE_LINE_MAX = 64;

/**
 * The title as one line, or two lines split at the space that balances their lengths best (a split right after a sentence / clause
 * mark — '.', '·', ':', ';', ',' — wins a near tie: the lines then read as phrases).
 */
export function balancedLines(text: string, oneLineMax = OBJECTIVE_ONE_LINE_MAX): string[] {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= oneLineMax) return [t];
  let best = -1, bestScore = Infinity;
  for (let i = 1; i < t.length - 1; i++) {
    if (t[i] !== ' ') continue;
    const a = t.slice(0, i).trim(), b = t.slice(i + 1).trim();
    if (!a || !b || b === '·') continue;
    const mark = /[.·:;,]$/.test(a) ? 6 : 0;
    const score = Math.abs(a.length - b.length) - mark;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return [t];
  return [t.slice(0, best).trim(), t.slice(best + 1).trim()];
}

/** Sets the objective title element: one text line, or two block lines (span.ln) when the title is long. */
export function setObjectiveTitle(el: Element, text: string): void {
  const lines = balancedLines(text);
  // the panel's width bound applies to a two-line title only (every other objective panel — the Reactor's chain — is unchanged)
  el.parentElement?.classList.toggle('obj-two-line', lines.length > 1);
  if (lines.length === 1) { el.textContent = lines[0]; return; }
  const doc = el.ownerDocument;
  el.replaceChildren(...lines.map(l => { const s = doc.createElement('span'); s.className = 'ln'; s.textContent = l; return s; }));
}
