// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): inline SVG HUD glyphs of the mini-golf items
// (items/golfItems.ts), same 64x32 silhouette style as ui/icons.ts. They are the fallback when the rendered 3D icon (ui/itemIcons.ts: the
// putter's cooked model, the ball's code-built sphere) is missing; the HUD hotbar / prompt / drag ghost use them the same way.
import type {GolfIconKey} from '../items/golfItems';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const GOLF_ICONS: Record<GolfIconKey, string> = {
  // a putter lying along X: rubber grip at the left, the long thin shaft, the flat blade head at the right with its face line
  putter: S(`<rect x="2" y="13.5" width="17" height="5" rx="2"/><path d="M5 13.5v5M9 13.5v5M13 13.5v5" stroke="${DARK}" stroke-width="0.9" opacity="0.45"/><rect x="19" y="15" width="35" height="2" rx="1"/><rect x="53" y="9" width="7" height="16" rx="1.2"/><rect x="58.6" y="10" width="1.4" height="14" fill="${DARK}" opacity="0.4"/>`),
  // a ball with a few dimples
  golfBall: S(`<circle cx="32" cy="16" r="11"/><circle cx="28" cy="12" r="1.3" fill="${DARK}" opacity="0.3"/><circle cx="33" cy="11" r="1.3" fill="${DARK}" opacity="0.3"/><circle cx="37" cy="15" r="1.3" fill="${DARK}" opacity="0.3"/><circle cx="30" cy="17" r="1.3" fill="${DARK}" opacity="0.3"/><circle cx="35" cy="20" r="1.3" fill="${DARK}" opacity="0.3"/><circle cx="26" cy="21" r="1.3" fill="${DARK}" opacity="0.3"/>`),
};
