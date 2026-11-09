// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): inline SVG HUD glyphs for the pantry foods / drinks
// (items/pantryFood.ts), the same 64x32 silhouette style as ui/icons.ts (tins like beans, bags like chips, bottles like water, cartons
// like juice) — the HUD fallback when the rendered 3D icon (ui/itemIcons.ts) is unavailable. Silhouettes only: no label art.
import type {PantryIconKey} from '../items/pantryFood';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';
const band = (x: number, y: number, w: number, h: number, o = 0.45) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${DARK}" opacity="${o}"/>`;

export const PANTRY_FOOD_ICONS: Record<PantryIconKey, string> = {
  // a tapered oblong tin with its opening key on the side
  corned_beef: S(`<path d="M22 8h20l-2 21H24z"/><rect x="21" y="6" width="22" height="3" rx="1" opacity="0.7"/>${band(23, 14, 18, 7)}<path d="M44 12h6v2h-6zM49 10h3v6h-3z" opacity="0.8"/>`),
  // a flat ring-pull tin seen from above-front
  sardines: S(`<rect x="12" y="12" width="40" height="13" rx="5"/><rect x="14" y="10" width="36" height="4" rx="2" opacity="0.7"/><circle cx="18" cy="12" r="2.6" fill="none" stroke="${DARK}" stroke-width="1.2" opacity="0.6"/>${band(22, 16, 22, 5, 0.4)}`),
  // a gusseted ration pouch with a tear notch
  field_ration: S(`<path d="M20 5h24l1 22-3 3H22l-3-3z"/><path d="M20 9h25" stroke="${DARK}" stroke-width="1.4" opacity="0.5"/>${band(24, 14, 16, 8, 0.4)}<path d="M41 5l3 3" stroke="${DARK}" stroke-width="1.2" opacity="0.6"/>`),
  // a foil-wrapped brick lying flat, scored into bars
  ration_brick: S(`<path d="M10 14l8-5h36l-8 5z" opacity="0.75"/><rect x="10" y="14" width="36" height="12" rx="1"/><path d="M46 14l8-5v12l-8 5z" opacity="0.6"/><path d="M22 14v12M34 14v12" stroke="${DARK}" stroke-width="1.4" opacity="0.5"/>`),
  // a glass jar with a lid and vegetables in brine
  pickles: S(`<rect x="22" y="3" width="20" height="5" rx="1.5" opacity="0.8"/><rect x="21" y="8" width="22" height="22" rx="4"/><ellipse cx="28" cy="20" rx="3" ry="6" fill="${DARK}" opacity="0.35"/><ellipse cx="36" cy="18" rx="3" ry="7" fill="${DARK}" opacity="0.35"/>`),
  // a squat tub with a wide lid
  peanut_butter: S(`<rect x="19" y="6" width="26" height="5" rx="1.5" opacity="0.8"/><path d="M20 11h24l-1 17a2 2 0 0 1-2 2H23a2 2 0 0 1-2-2z"/>${band(21, 16, 22, 7)}`),
  // an upright cracker box with crackers peeking out
  saltines: S(`<rect x="14" y="8" width="36" height="21" rx="1"/><path d="M14 8l4-4h28l4 4z" opacity="0.7"/>${band(18, 13, 28, 9, 0.4)}<rect x="22" y="15" width="7" height="5" rx="0.6" opacity="0.6"/><rect x="31" y="15" width="7" height="5" rx="0.6" opacity="0.6"/>`),
  // a stand-up pouch with a window
  jerky: S(`<path d="M22 3h20l1 4-1 20 2 3H20l2-3-1-20z"/><path d="M21 7h22" stroke="${DARK}" stroke-width="1.2" opacity="0.5"/><path d="M26 13h12v9H26z" fill="${DARK}" opacity="0.45"/>`),
  // a bag with a clear window of nuts
  trail_mix: S(`<path d="M20 4h24l-2 4 2 18-2 4H22l-2-4 2-18z"/><path d="M25 14h14v9H25z" fill="${DARK}" opacity="0.4"/><circle cx="29" cy="18" r="1.4"/><circle cx="34" cy="19.5" r="1.4"/><circle cx="31" cy="21" r="1.2"/>`),
  // a squeeze bottle with a flip cap
  honey: S(`<path d="M28 1h8v4h-8z" opacity="0.85"/><path d="M26 5h12l2 4v18a3 3 0 0 1-3 3H27a3 3 0 0 1-3-3V9z"/>${band(24, 14, 16, 7)}`),
  // a round cookie tin seen from the front
  butter_cookies: S(`<ellipse cx="32" cy="10" rx="21" ry="5" opacity="0.8"/><path d="M11 10h42v14c0 3-9 6-21 6s-21-3-21-6z"/>${band(11, 16, 42, 5, 0.35)}<ellipse cx="32" cy="10" rx="15" ry="3" fill="${DARK}" opacity="0.3"/>`),
  // four cups in a sleeve
  pudding_cups: S(`<path d="M9 12h11l-1.5 14h-8z"/><path d="M21 12h11l-1.5 14h-8z"/><path d="M33 12h11l-1.5 14h-8z"/><path d="M45 12h11l-1.5 14h-8z"/><rect x="8" y="9" width="49" height="3" rx="1" opacity="0.7"/>${band(9, 17, 47, 5, 0.35)}`),
  // a spouted pouch
  fruit_puree: S(`<rect x="29" y="1" width="6" height="5" rx="1" opacity="0.85"/><path d="M30 6h4l9 4v18a2 2 0 0 1-2 2H23a2 2 0 0 1-2-2V10z"/><circle cx="32" cy="19" r="4.5" fill="${DARK}" opacity="0.4"/>`),
  // three little boxes banded together
  raisins: S(`<rect x="15" y="8" width="10" height="20" rx="0.8"/><rect x="27" y="8" width="10" height="20" rx="0.8"/><rect x="39" y="8" width="10" height="20" rx="0.8"/>${band(14, 15, 36, 4, 0.5)}`),
  // a sausage chub lying along X with clipped ends
  smoked_sausage: S(`<rect x="8" y="12" width="48" height="10" rx="5"/><rect x="4" y="15" width="5" height="4" rx="1" opacity="0.7"/><rect x="55" y="15" width="5" height="4" rx="1" opacity="0.7"/>${band(22, 12, 18, 10, 0.3)}`),
  // a waxed cheese round with a cut-open tab
  wax_cheese: S(`<ellipse cx="32" cy="12" rx="18" ry="5" opacity="0.8"/><path d="M14 12h36v9c0 3-8 6-18 6s-18-3-18-6z"/><path d="M38 9l8 1-3 4z" fill="${DARK}" opacity="0.45"/>`),
  // a tall canister with a lid
  rolled_oats: S(`<rect x="22" y="2" width="20" height="4" rx="1.5" opacity="0.8"/><rect x="22" y="6" width="20" height="24" rx="2"/>${band(22, 12, 20, 9, 0.4)}<circle cx="32" cy="16.5" r="3" opacity="0.5"/>`),
  // a long tray pack lying flat, crackers through the window
  rice_crackers: S(`<path d="M6 13l4-3h44l4 3v10l-4 3H10l-4-3z"/><circle cx="20" cy="18" r="3.5" fill="${DARK}" opacity="0.4"/><circle cx="32" cy="18" r="3.5" fill="${DARK}" opacity="0.4"/><circle cx="44" cy="18" r="3.5" fill="${DARK}" opacity="0.4"/>`),
  // a ribbed squeeze-cap bottle
  sports_drink: S(`<rect x="28" y="1" width="8" height="4" rx="1" opacity="0.85"/><path d="M28 5h8l3 5v18a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2V10z"/><path d="M25 13h14M25 25h14" stroke="${DARK}" stroke-width="1.2" opacity="0.5"/>${band(25, 16, 14, 6)}`),
  // a slim tall can
  iced_coffee: S(`<rect x="26" y="4" width="12" height="25" rx="2.5"/><rect x="27" y="2" width="10" height="3" rx="1"/>${band(26, 12, 12, 9, 0.45)}`),
  // a glass bottle with a crimped cap
  iced_tea: S(`<rect x="29" y="0.5" width="6" height="3" rx="0.8" opacity="0.85"/><path d="M29 3h6v5l4 5v15a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2V13l4-5z"/>${band(25, 17, 14, 7)}`),
  // three juice boxes with straws
  juice_boxes: S(`<rect x="13" y="10" width="12" height="19" rx="0.8"/><rect x="26" y="10" width="12" height="19" rx="0.8"/><rect x="39" y="10" width="12" height="19" rx="0.8"/><path d="M21 10V4M34 10V4M47 10V4" stroke="currentColor" stroke-width="1.6"/>${band(13, 17, 38, 5, 0.4)}`),
  // a milk brick carton with a screw cap
  uht_milk: S(`<path d="M24 8l4-4h8l4 4v22H24z"/><rect x="29" y="1" width="6" height="4" rx="1" opacity="0.8"/>${band(24, 14, 16, 8, 0.4)}`),
  // a glass soda bottle
  ginger_soda: S(`<rect x="29" y="0.5" width="6" height="3" rx="0.8" opacity="0.85"/><path d="M29.5 3h5l1 8 3.5 4v13a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2V15l3.5-4z"/>${band(25, 18, 14, 6)}`),
};
