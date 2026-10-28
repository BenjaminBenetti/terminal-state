// Inline SVG item icons (simple silhouettes drawn for the HUD).

import type {IconKey} from '../items/items';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const ICONS: Record<IconKey, string> = {
  rifle: S('<path d="M2 15h9l2-3h22l3-2h12v3h10v3H50l-2 2h-6l-1 8h-5l1-8h-6l-3 4h-4l1-4h-8l-3 3H2z"/><rect x="26" y="8" width="10" height="3"/>'),
  shotgun: S('<path d="M1 14h40l2-2h19v4H44l-2 1h-6l-1 2h-6l-1-2H14l-9 7H1l7-7H1z"/><rect x="30" y="17" width="12" height="3"/>'),
  // Pistol (pistol lane): HUD silhouette; the inventory icon falls back to it while the pistol has no model.
  pistol: S('<path d="M14 9h34v7H33l-2 2h-4l-2 9h-8l3-11h-6z"/><rect x="44" y="7" width="3" height="2"/><path d="M27 18h4l-1 4h-4z" opacity="0.6"/>'),
  rounds9: S('<g><rect x="17" y="13" width="7" height="12" rx="1"/><path d="M17 13l3.5-5 3.5 5z"/><rect x="29" y="13" width="7" height="12" rx="1"/><path d="M29 13l3.5-5 3.5 5z"/><rect x="41" y="13" width="7" height="12" rx="1"/><path d="M41 13l3.5-5 3.5 5z"/></g>'),
  rounds: S('<g><rect x="14" y="10" width="7" height="16" rx="1"/><path d="M14 10l3.5-7 3.5 7z"/><rect x="28" y="10" width="7" height="16" rx="1"/><path d="M28 10l3.5-7 3.5 7z"/><rect x="42" y="10" width="7" height="16" rx="1"/><path d="M42 10l3.5-7 3.5 7z"/></g>'),
  shells: S('<g><rect x="18" y="6" width="10" height="20" rx="2"/><rect x="18" y="22" width="10" height="5"/><rect x="34" y="6" width="10" height="20" rx="2"/><rect x="34" y="22" width="10" height="5"/></g>'),
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
};

/** Small square HUD icons for the survival bars. */
const Q = (body: string) => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const STAT_ICONS = {
  // fork + knife
  food: Q('<path d="M3 1h1v4h1V1h1v4h1V1h1v5a2 2 0 0 1-1.5 1.9V15h-2V7.9A2 2 0 0 1 3 6z"/><path d="M11 1c1.7 0 2.5 2 2.5 5 0 1.5-.6 2.4-1.5 2.7V15h-2V1z"/>'),
  // water drop
  water: Q('<path d="M8 1c2.5 3.6 5 6.6 5 9.2A5 5 0 0 1 3 10.2C3 7.6 5.5 4.6 8 1z"/>'),
};
