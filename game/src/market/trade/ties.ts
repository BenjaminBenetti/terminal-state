// Task studio-survivor-market-20261108-005807-01 (lane TRADE): RAIL TIES — the survivor market's currency (user decision): literally
// reclaimed railroad track ties (wooden sleepers), NOT coins, scrip or printed chits. Short name "ties".
// Task studio-market-rework-20261108-074144-01 (lane TRADE): now a PHYSICAL ITEM (items/railTies.ts `rail_ties`, stack 1000) carried in the
// inventory like any stack — paid and received only through market/trade/payment.ts; no hidden balance, nothing on the HUD. The trade
// view (and a small "· N ties" tail on a stall's [E] prompt) show the ties you carry.
//
// TIE_GLYPH: the small track-tie mark next to every amount (an inline SVG glyph in the style of the HUD's silhouette icons, ui/icons.ts):
// a weathered timber sleeper with its two steel tie plates and spike heads. UI iconography, not a texture.
export {RAIL_TIES_ID, RAIL_TIES_STACK} from '../../items/railTies';

export const RAIL_TIES = {
  /** The currency's name (headings, help text). */
  name: 'Rail Ties',
  /** Short plural / singular for amounts ("12 ties", "1 tie"). */
  many: 'ties',
  one: 'tie',
} as const;

/** "1 tie", "12 ties", "0 ties". */
export function tiesText(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return `${v} ${v === 1 ? RAIL_TIES.one : RAIL_TIES.many}`;
}

/** The track-tie glyph (inline SVG, ~22 x 9 px): a timber sleeper, grain lines, two tie plates with spike heads. */
export const TIE_GLYPH = '<svg class="tie-glyph" viewBox="0 0 44 18" width="22" height="9" aria-hidden="true">'
  + '<rect x="1" y="4" width="42" height="10" rx="1.2" fill="#6e5136"/>'
  + '<path d="M3 7.2h17M24 7.4h17M3 10.8h11M18 11h23" stroke="#4a3524" stroke-width="0.9" fill="none"/>'
  + '<rect x="7" y="2" width="7.5" height="14" rx="0.6" fill="#8c9297"/><rect x="29.5" y="2" width="7.5" height="14" rx="0.6" fill="#8c9297"/>'
  + '<circle cx="8.8" cy="4.2" r="1" fill="#3a3f43"/><circle cx="12.7" cy="13.8" r="1" fill="#3a3f43"/>'
  + '<circle cx="31.3" cy="13.8" r="1" fill="#3a3f43"/><circle cx="35.2" cy="4.2" r="1" fill="#3a3f43"/></svg>';

/** An amount as markup: the glyph + "12 ties". */
export function tiesHtml(n: number): string {
  return `<span class="ties">${TIE_GLYPH}<b>${tiesText(n)}</b></span>`;
}
