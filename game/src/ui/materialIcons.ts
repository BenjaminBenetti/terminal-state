// Task office-props-physics-scale-20261030 (lane RACK): inline SVG icons for the crafting materials (items/craftMaterials.ts), same
// 64x32 silhouette style as ui/icons.ts. They are the fallback when the rendered 3D icon (ui/itemIcons.ts) is missing; the HUD
// hotbar / prompt / drag ghost use them the same way.
import type {MaterialIconKey} from '../items/craftMaterials';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const MATERIAL_ICONS: Record<MaterialIconKey, string> = {
  // circuit board (chips + traces) with a coil of wire at the right
  electrical: S(`<rect x="6" y="9" width="34" height="18" rx="1.5"/><rect x="11" y="13" width="8" height="6" fill="${DARK}" opacity="0.6"/><rect x="23" y="13" width="5" height="5" fill="${DARK}" opacity="0.55"/><rect x="31" y="12" width="5" height="9" fill="${DARK}" opacity="0.5"/><path d="M9 24h14M19 19v5M28 18v6h8" fill="none" stroke="${DARK}" stroke-width="1" opacity="0.5"/><ellipse cx="50" cy="18" rx="9" ry="7" fill="none" stroke="currentColor" stroke-width="2.4"/><ellipse cx="50" cy="18" rx="5.5" ry="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M41 18h-4" stroke="currentColor" stroke-width="1.6"/>`),
  // bent L-bracket, a punched plate and a short rail
  scrap: S(`<path d="M6 8h6v14h16v6H6z"/><path d="M30 10l22-3 3 14-22 4z" opacity="0.85"/><circle cx="37" cy="15" r="1.8" fill="${DARK}" opacity="0.6"/><circle cx="46" cy="14" r="1.8" fill="${DARK}" opacity="0.6"/><rect x="14" y="4" width="44" height="4" rx="0.8" transform="rotate(4 36 6)" opacity="0.7"/><path d="M20 5.2h2M30 5.9h2M40 6.6h2M50 7.3h2" stroke="${DARK}" stroke-width="1.2" opacity="0.6"/>`),
  // screw-lid specimen jar with a label band and the culture inside
  biomater: S(`<rect x="24" y="3" width="16" height="5" rx="1"/><path d="M23 8h18v19a3 3 0 0 1-3 3H26a3 3 0 0 1-3-3z" opacity="0.55"/><path d="M24.5 18c3-2 5 1 7.5-0.5s5-1.5 7.5 0.5V27a2 2 0 0 1-2 2H26.5a2 2 0 0 1-2-2z"/><rect x="23" y="11" width="18" height="5" fill="${DARK}" opacity="0.4"/>`),
};
