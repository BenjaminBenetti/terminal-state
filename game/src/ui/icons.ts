// Inline SVG item icons (simple silhouettes drawn for the HUD).

import type {IconKey} from '../items/items';
import {GEAR_ICONS} from './gearIcons'; // Iteration 16 (lane GEAR)
import {MEDICAL_ICONS} from './medicalIcons'; // Iteration 16 (lane INJURY)
import {MATERIAL_ICONS} from './materialIcons'; // lane RACK (office-props-physics-scale-20261030): crafting materials
import {SKYWAYS_FOOD_ICONS} from './skywaysFoodIcons'; // task studio-skyways-level-20261106-054448 (lane FOOD): ramen / bento / bubble tea

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const ICONS: Record<IconKey, string> = {
  rifle: S('<path d="M2 15h9l2-3h22l3-2h12v3h10v3H50l-2 2h-6l-1 8h-5l1-8h-6l-3 4h-4l1-4h-8l-3 3H2z"/><rect x="26" y="8" width="10" height="3"/>'),
  shotgun: S('<path d="M1 14h40l2-2h19v4H44l-2 1h-6l-1 2h-6l-1-2H14l-9 7H1l7-7H1z"/><rect x="30" y="17" width="12" height="3"/>'),
  // Pistol (pistol lane): HUD silhouette; the inventory icon falls back to it while the pistol has no model.
  pistol: S('<path d="M14 9h34v7H33l-2 2h-4l-2 9h-8l3-11h-6z"/><rect x="44" y="7" width="3" height="2"/><path d="M27 18h4l-1 4h-4z" opacity="0.6"/>'),
  // Lane AMMO (knife-melee-20261030): one icon per CALIBER with its label (fallback when the 3D icon render is unavailable).
  ammo9mm: S('<g><rect x="3" y="13" width="7" height="12" rx="1"/><path d="M3 13l3.5-5 3.5 5z"/><rect x="13" y="13" width="7" height="12" rx="1"/><path d="M13 13l3.5-5 3.5 5z"/><rect x="23" y="13" width="7" height="12" rx="1"/><path d="M23 13l3.5-5 3.5 5z"/></g><text x="62" y="21" font-size="10" font-weight="700" font-family="Arial, sans-serif" text-anchor="end">9mm</text>'),
  ammo556: S('<g><rect x="2" y="10" width="7" height="16" rx="1"/><path d="M2 10l3.5-7 3.5 7z"/><rect x="12" y="10" width="7" height="16" rx="1"/><path d="M12 10l3.5-7 3.5 7z"/><rect x="22" y="10" width="7" height="16" rx="1"/><path d="M22 10l3.5-7 3.5 7z"/></g><text x="62" y="21" font-size="10" font-weight="700" font-family="Arial, sans-serif" text-anchor="end">5.56</text>'),
  ammo12ga: S('<g><rect x="2" y="6" width="10" height="20" rx="2"/><rect x="2" y="22" width="10" height="5"/><rect x="15" y="6" width="10" height="20" rx="2"/><rect x="15" y="22" width="10" height="5"/></g><text x="62" y="21" font-size="10" font-weight="700" font-family="Arial, sans-serif" text-anchor="end">12ga</text>'),
  medkit: S('<path d="M12 8h40v20H12z" opacity="0.9"/><path d="M28 11h8v5h5v6h-5v5h-8v-5h-5v-6h5z" fill="#15171a"/><rect x="26" y="4" width="12" height="4"/>'),
  bandage: S('<ellipse cx="24" cy="16" rx="8" ry="11"/><path d="M24 5h22v22H24z"/><ellipse cx="46" cy="16" rx="8" ry="11" opacity="0.6"/>'),
  // Food and drink (iteration 03).
  water: S(`<path d="M29 2h6v4l4 5v17a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2V11l4-5z"/><rect x="25" y="15" width="14" height="7" fill="${DARK}" opacity="0.45"/>`),
  cola: S(`<rect x="24" y="5" width="16" height="24" rx="3"/><rect x="26" y="3" width="12" height="3" rx="1"/><path d="M24 17c5-4 11 3 16-2v4c-5 4-11-3-16 2z" fill="${DARK}" opacity="0.5"/>`),
  juice: S(`<path d="M24 11l8-7 8 7v19H24z"/><rect x="29" y="1" width="6" height="4"/><circle cx="32" cy="20" r="4.5" fill="${DARK}" opacity="0.45"/>`),
  chocolate: S(`<rect x="12" y="10" width="40" height="13" rx="1"/><path d="M22 10v13M32 10v13M42 10v13" stroke="${DARK}" stroke-width="1.6" opacity="0.6"/><rect x="12" y="10" width="5" height="13" opacity="0.7"/>`),
  chips: S(`<path d="M20 4h24l-2 4 2 16-2 5H22l-2-5 2-16z"/><path d="M24 13h16v7H24z" fill="${DARK}" opacity="0.45"/>`),
  beans: S(`<rect x="22" y="6" width="20" height="22" rx="2"/><rect x="21" y="6" width="22" height="3" rx="1" opacity="0.7"/><rect x="21" y="25" width="22" height="3" rx="1" opacity="0.7"/><rect x="22" y="13" width="20" height="8" fill="${DARK}" opacity="0.4"/>`),
  noodles: S(`<path d="M20 9h24l-3 20H23z"/><rect x="18" y="5" width="28" height="4" rx="1"/><rect x="21" y="15" width="22" height="5" fill="${DARK}" opacity="0.45"/>`),
  // lane FURN (office-props-physics-scale-20261030): a round crusty loaf with scored top
  bread: S(`<path d="M14 26c-3 0-4-3-3-6 2-7 10-12 21-12s19 5 21 12c1 3 0 6-3 6z"/><path d="M22 13l4 6M30 11l4 7M38 12l4 6" stroke="${DARK}" stroke-width="1.6" opacity="0.5"/>`),
  // Iteration 12 (LIGHT): D cell (upright, + nub) and road flare (tube, striker cap at the right).
  battery: S(`<rect x="25" y="7" width="14" height="22" rx="2"/><rect x="29" y="3" width="6" height="4" rx="1"/><rect x="25" y="12" width="14" height="6" fill="${DARK}" opacity="0.45"/>`),
  flare: S(`<rect x="6" y="12" width="40" height="9" rx="2"/><rect x="45" y="11" width="11" height="11" rx="2" opacity="0.75"/><rect x="14" y="13" width="18" height="7" fill="${DARK}" opacity="0.4"/>`),
  // Lane KNIFE: survival knife silhouette (pommel + ridged grip at the left, cross guard, clip-point blade to the right, serrated spine).
  // Task gasmask-breach-20261030 (mask lane): screw-in filter canister standing on its base (threaded neck up, perforated base band).
  // task train-fuel-system: a jerrycan silhouette (handle trio on top, spout to the side) — a HUD glyph like every item's
  fuelCan: S(`<path d="M22 8h14l6 5v18a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z"/><rect x="36" y="3" width="5" height="6" rx="1" transform="rotate(30 38 6)"/><rect x="23" y="11" width="10" height="3" rx="1" fill="${DARK}" opacity="0.5"/><path d="M23 18l15 11M38 18L23 29" stroke="${DARK}" stroke-width="1.6" opacity="0.45"/>`),
  filter: S(`<rect x="27" y="3" width="10" height="6" rx="1" opacity="0.8"/><path d="M27 4.8h10M27 6.8h10" stroke="${DARK}" stroke-width="0.8" opacity="0.6"/><rect x="21" y="9" width="22" height="20" rx="3.5"/><rect x="21" y="14" width="22" height="6" fill="${DARK}" opacity="0.4"/><path d="M25 25h1.6M29 25h1.6M33 25h1.6M37 25h1.6" stroke="${DARK}" stroke-width="1.6" opacity="0.55"/>`),
  knife: S(`<rect x="4" y="13" width="4" height="7" rx="1.5"/><rect x="8" y="13.5" width="14" height="6" rx="2"/><path d="M11 13.5v6M15 13.5v6M19 13.5v6" stroke="${DARK}" stroke-width="1" opacity="0.5"/><rect x="22" y="9" width="3" height="15" rx="1"/><path d="M25 12.5h26l9 4.5-6 2.5H25z"/><path d="M28 12.5l1-1.5 1 1.5 1-1.5 1 1.5 1-1.5 1 1.5 1-1.5 1 1.5 1-1.5 1 1.5" fill="none" stroke="currentColor" stroke-width="0.8"/>`),
  ...GEAR_ICONS,
  ...MEDICAL_ICONS,
  ...MATERIAL_ICONS,
  ...SKYWAYS_FOOD_ICONS, // task studio-skyways-level-20261106-054448 (lane FOOD)
  // task reactor-build-20261101 (lane RESTART): HUD silhouettes (fallback when the 3D icon render is unavailable) — a key on a fob tag;
  // a fuse cartridge lying along X (ceramic body, end caps, blade contacts)
  reactorKey: S(`<rect x="4" y="9" width="20" height="14" rx="4"/><circle cx="9" cy="16" r="2.2" fill="${DARK}" opacity="0.55"/><circle cx="29" cy="16" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="38" cy="16" r="5"/><circle cx="38" cy="16" r="1.8" fill="${DARK}" opacity="0.5"/><path d="M42 14.5h18v3h-3v3h-3v-3h-3v3h-3v-3h-6z"/>`),
  fuseCartridge: S(`<rect x="15" y="8" width="34" height="16" rx="3"/><rect x="11" y="7" width="6" height="18" rx="1.5" opacity="0.75"/><rect x="47" y="7" width="6" height="18" rx="1.5" opacity="0.75"/><rect x="3" y="14" width="9" height="4"/><rect x="52" y="14" width="9" height="4"/><rect x="24" y="12" width="16" height="8" fill="${DARK}" opacity="0.3"/>`),
  // task studio-market-rework-20261108-074144-01 (lane TRADE): Rail Ties — a 2 x 2 bundle of tie offcuts seen end-on-ish, two steel straps
  // (the HUD glyph style; the 3D icon is the code-built bundle, world/railTiesModel.ts)
  railTies: S(`<rect x="8" y="5" width="47" height="10" rx="1"/><rect x="8" y="17" width="47" height="10" rx="1"/><path d="M8 15h47M31.5 5v22" stroke="${DARK}" stroke-width="1.4" opacity="0.6"/><path d="M12 9h14M36 10h15M13 21h12M37 22h14" stroke="${DARK}" stroke-width="0.9" opacity="0.4"/><rect x="16" y="3.5" width="4" height="25" rx="0.8" opacity="0.7"/><rect x="43" y="3.5" width="4" height="25" rx="0.8" opacity="0.7"/>`),
};

/** Iteration 12 (LIGHT): small square HUD icons for the light panel (battery meter, flare count). */
export const LIGHT_ICONS = {
  battery: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="4" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="6.5" width="2" height="3"/></svg>`,
  flare: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 13l7-7 2 2-7 7z"/><path d="M11 2c1.6 1 2.6 2.4 2.4 3.8-.2 1-1 1.6-1.8 1.4C10.7 6.9 10.3 6 10.6 5c.2-.9.6-1.8.4-3z" opacity="0.8"/></svg>`,
};

/** Small square HUD icons for the survival bars. */
const Q = (body: string) => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const STAT_ICONS = {
  // fork + knife
  food: Q('<path d="M3 1h1v4h1V1h1v4h1V1h1v5a2 2 0 0 1-1.5 1.9V15h-2V7.9A2 2 0 0 1 3 6z"/><path d="M11 1c1.7 0 2.5 2 2.5 5 0 1.5-.6 2.4-1.5 2.7V15h-2V1z"/>'),
  // water drop
  water: Q('<path d="M8 1c2.5 3.6 5 6.6 5 9.2A5 5 0 0 1 3 10.2C3 7.6 5.5 4.6 8 1z"/>'),
};
