// Task studio-skyways-level-20261106-054448 (lane FOOD): inline SVG icons for the Skyways ramen restaurant's food (items/skywaysFood.ts),
// the same 64x32 silhouette style as ui/icons.ts — the HUD fallback when the rendered 3D icon (ui/itemIcons.ts) is unavailable.
import type {SkywaysFoodIconKey} from '../items/skywaysFood';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const SKYWAYS_FOOD_ICONS: Record<SkywaysFoodIconKey, string> = {
  // a wide noodle bowl on its foot ring, chopsticks across the rim, steam-less (it is cold)
  ramen: S(`<path d="M12 14h40c0 8-8 13-20 13S12 22 12 14z"/><rect x="26" y="27" width="12" height="3" rx="1"/><path d="M14 14c4-3 10-4 18-4s14 1 18 4z" fill="${DARK}" opacity="0.45"/><path d="M18 9l30 3M18 7l30 4" stroke="currentColor" stroke-width="1.6"/>`),
  // a deeper bowl with two slices of pork belly on top
  ramen_chashu: S(`<path d="M13 13h38c0 9-8 15-19 15S13 22 13 13z"/><rect x="26" y="28" width="12" height="2.5" rx="1"/><ellipse cx="25" cy="11" rx="7" ry="3"/><ellipse cx="38" cy="11" rx="7" ry="3"/><path d="M19 11h12M32 11h12" stroke="${DARK}" stroke-width="1" opacity="0.5"/>`),
  // an open bento box seen from above-front: compartments with nigiri / maki rounds
  sushi_bento: S(`<rect x="8" y="7" width="48" height="20" rx="2"/><path d="M30 7v20M8 17h22" stroke="${DARK}" stroke-width="1.6" opacity="0.6"/><circle cx="37" cy="13" r="3" fill="${DARK}" opacity="0.45"/><circle cx="45" cy="13" r="3" fill="${DARK}" opacity="0.45"/><circle cx="41" cy="21" r="3" fill="${DARK}" opacity="0.45"/><rect x="11" y="10" width="15" height="4" rx="2" fill="${DARK}" opacity="0.35"/><rect x="11" y="20" width="15" height="4" rx="2" fill="${DARK}" opacity="0.35"/>`),
  // a tall cup with a domed lid, a fat straw and pearls at the bottom
  bubble_tea: S(`<path d="M24 9h16l-2 21H26z"/><path d="M23 9c0-3 4-5 9-5s9 2 9 5z" opacity="0.8"/><rect x="33" y="0" width="3" height="7" rx="1" transform="rotate(12 34 4)"/><circle cx="29" cy="26" r="1.6" fill="${DARK}" opacity="0.6"/><circle cx="33" cy="27" r="1.6" fill="${DARK}" opacity="0.6"/><circle cx="36" cy="25" r="1.6" fill="${DARK}" opacity="0.6"/><circle cx="31" cy="23.5" r="1.6" fill="${DARK}" opacity="0.6"/>`),
};
